use std::path::Path;

use anyhow::Result;
use async_trait::async_trait;
use bincode::{Decode, Encode};
use serde::{Deserialize, Serialize};
use turbo_rcstr::{RcStr, rcstr};
use turbo_tasks::{NonLocalValue, OperationValue, OperationVc, trace::TraceRawVcs};
use turbo_tasks_fs::{
    DiskFileSystem, DiskFileSystemMap, DiskWatcherConfig, DiskWatcherRecursiveMode, FileSystemPath,
    canonicalize_to_rcstr,
};
use turbopack_core::issue::{Issue, IssueExt, IssueSeverity, IssueStage, StyledString};

use crate::project::disk_file_system_with_options_operation;

#[derive(
    Clone,
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    NonLocalValue,
    OperationValue,
    TraceRawVcs,
    Encode,
    Decode,
)]
pub struct AdditionalRootConfig {
    pub(crate) key: RcStr,
    pub(crate) path: RcStr,
    canonical_path: Result<RcStr, AdditionalRootIssue>,
}

impl AdditionalRootConfig {
    pub fn canonicalize(key: RcStr, path: RcStr, optional: bool) -> Option<Self> {
        let canonical_path =
            canonicalize_to_rcstr(Path::new(&*path)).map_err(|error| AdditionalRootIssue {
                key: key.clone(),
                path: path.clone(),
                reason: AdditionalRootIssueReason::Io(RcStr::from(error.to_string())),
            });
        if optional && canonical_path.is_err() {
            return None;
        }
        Some(Self {
            key,
            path,
            canonical_path,
        })
    }
}

#[derive(
    Clone,
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    NonLocalValue,
    OperationValue,
    TraceRawVcs,
    Encode,
    Decode,
)]
pub(crate) struct AdditionalRootIssue {
    key: RcStr,
    path: RcStr,
    reason: AdditionalRootIssueReason,
}

#[derive(
    Clone,
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    NonLocalValue,
    OperationValue,
    TraceRawVcs,
    Encode,
    Decode,
)]
enum AdditionalRootIssueReason {
    // io errors are stringified because `io::Error` does not implement the required traits
    Io(RcStr),
    OverlappingRoot { key: Option<RcStr>, path: RcStr },
}

impl AdditionalRootIssueReason {
    fn description(&self) -> StyledString {
        match self {
            Self::Io(error) => StyledString::Text(error.clone()),
            Self::OverlappingRoot {
                key: Some(key),
                path,
            } => StyledString::Line(vec![
                StyledString::Text(rcstr!("the root overlaps additional root ")),
                StyledString::Code(path.clone()),
                StyledString::Text(rcstr!(" configured as ")),
                StyledString::Code(key.clone()),
            ]),
            Self::OverlappingRoot { key: None, path } => StyledString::Line(vec![
                StyledString::Text(rcstr!("the root overlaps the project root ")),
                StyledString::Code(path.clone()),
            ]),
        }
    }
}

pub(crate) struct AdditionalRoots {
    pub file_systems: Vec<(RcStr, OperationVc<DiskFileSystem>)>,
    pub issues: Vec<AdditionalRootIssue>,
}

pub(crate) fn create_additional_root_file_systems(
    additional_roots: &[AdditionalRootConfig],
    project_root: &RcStr,
    watcher_config: DiskWatcherConfig,
    map: OperationVc<DiskFileSystemMap>,
) -> Result<AdditionalRoots> {
    let mut accepted: Vec<(RcStr, RcStr)> = Vec::new();
    let mut file_systems = Vec::new();
    let mut issues = Vec::new();
    for additional_root in additional_roots {
        let canonical = match &additional_root.canonical_path {
            Ok(path) => path.clone(),
            Err(issue) => {
                issues.push(issue.clone());
                continue;
            }
        };
        let canonical_path = Path::new(&*canonical);
        if let Some((overlapping_key, overlapping_path)) =
            find_overlapping_root(canonical_path, project_root, &accepted)
        {
            issues.push(AdditionalRootIssue {
                key: additional_root.key.clone(),
                path: canonical,
                reason: AdditionalRootIssueReason::OverlappingRoot {
                    key: overlapping_key,
                    path: overlapping_path,
                },
            });
            continue;
        }
        let operation = disk_file_system_with_options_operation(
            format!("additional-root-{}", additional_root.key).into(),
            canonical.clone(),
            Vec::new(),
            DiskWatcherConfig {
                recursive_mode: Some(DiskWatcherRecursiveMode::NonRecursive),
                ..watcher_config
            },
            true,
            map,
        );
        accepted.push((additional_root.key.clone(), canonical));
        file_systems.push((additional_root.key.clone(), operation));
    }

    Ok(AdditionalRoots {
        file_systems,
        issues,
    })
}

fn find_overlapping_root(
    canonical: &Path,
    project_root: &RcStr,
    additional_roots: &[(RcStr, RcStr)],
) -> Option<(Option<RcStr>, RcStr)> {
    let project_root_path = Path::new(&**project_root);
    if canonical.starts_with(project_root_path) || project_root_path.starts_with(canonical) {
        return Some((None, project_root.clone()));
    }

    additional_roots.iter().find_map(|(key, root)| {
        let root_path = Path::new(&**root);
        (canonical.starts_with(root_path) || root_path.starts_with(canonical))
            .then(|| (Some(key.clone()), root.clone()))
    })
}

pub(crate) fn emit_additional_root_issues(path: FileSystemPath, issues: Vec<AdditionalRootIssue>) {
    for issue in issues {
        AdditionalRootConfigIssue {
            path: path.clone(),
            key: issue.key,
            configured_path: issue.path,
            reason: issue.reason,
        }
        .resolved_cell()
        .emit();
    }
}

#[turbo_tasks::value(shared)]
struct AdditionalRootConfigIssue {
    path: FileSystemPath,
    key: RcStr,
    configured_path: RcStr,
    reason: AdditionalRootIssueReason,
}

#[async_trait]
#[turbo_tasks::value_impl]
impl Issue for AdditionalRootConfigIssue {
    fn stage(&self) -> IssueStage {
        IssueStage::Config
    }

    fn severity(&self) -> IssueSeverity {
        IssueSeverity::Error
    }

    async fn file_path(&self) -> Result<FileSystemPath> {
        Ok(self.path.clone())
    }

    async fn title(&self) -> Result<StyledString> {
        Ok(StyledString::Text(rcstr!(
            "Invalid Turbopack additional root"
        )))
    }

    async fn description(&self) -> Result<Option<StyledString>> {
        Ok(Some(StyledString::Line(vec![
            StyledString::Text(rcstr!("The additional root ")),
            StyledString::Code(self.configured_path.clone()),
            StyledString::Text(rcstr!(" configured as ")),
            StyledString::Code(self.key.clone()),
            StyledString::Text(rcstr!(" is invalid: ")),
            self.reason.description(),
        ])))
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use turbo_rcstr::rcstr;

    use crate::additional_roots::{AdditionalRootIssueReason, find_overlapping_root};

    #[test]
    fn io_reason_retains_the_error_message() {
        let reason = AdditionalRootIssueReason::Io(rcstr!("missing root"));

        assert_eq!(reason.description().to_unstyled_string(), "missing root");
    }

    #[test]
    fn identifies_an_overlapping_project_root() {
        assert_eq!(
            find_overlapping_root(
                Path::new("/workspace/project/packages"),
                &rcstr!("/workspace/project"),
                &[],
            ),
            Some((None, rcstr!("/workspace/project")))
        );
    }

    #[test]
    fn identifies_the_first_overlapping_additional_root() {
        let additional_roots = vec![
            (rcstr!("one"), rcstr!("/external/one")),
            (rcstr!("two"), rcstr!("/external/two")),
        ];

        assert_eq!(
            find_overlapping_root(
                Path::new("/external/two/packages"),
                &rcstr!("/workspace/project"),
                &additional_roots,
            ),
            Some((Some(rcstr!("two")), rcstr!("/external/two")))
        );
    }

    #[test]
    fn formats_structured_overlap_reasons() {
        let project = AdditionalRootIssueReason::OverlappingRoot {
            key: None,
            path: rcstr!("/workspace/project"),
        };
        assert_eq!(
            project.description().to_unstyled_string(),
            "the root overlaps the project root /workspace/project"
        );

        let additional = AdditionalRootIssueReason::OverlappingRoot {
            key: Some(rcstr!("packages")),
            path: rcstr!("/external/packages"),
        };
        assert_eq!(
            additional.description().to_unstyled_string(),
            "the root overlaps additional root /external/packages configured as packages"
        );
    }
}

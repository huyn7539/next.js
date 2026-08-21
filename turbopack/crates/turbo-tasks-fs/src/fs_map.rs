use std::path::Path;

use turbo_rcstr::RcStr;
use turbo_tasks::{OperationVc, ResolvedVc, Vc};
use turbo_unix_path::sys_to_unix;

use crate::{DiskFileSystem, FileSystemPath};

/// An ordered set of canonical system roots and their owning filesystems.
///
/// Roots are validated to be non-overlapping before this value is constructed,
/// so lookup does not need longest-prefix matching.
#[turbo_tasks::value]
pub struct DiskFileSystemMap(pub Vec<(RcStr, ResolvedVc<DiskFileSystem>)>);

impl DiskFileSystemMap {
    /// Converts an absolute system path into a path owned by one of the installed filesystems.
    pub fn lookup(&self, path: &Path) -> Option<FileSystemPath> {
        for (root, fs) in &self.0 {
            let Ok(relative) = path.strip_prefix(Path::new(&**root)) else {
                continue;
            };
            let relative = relative.to_str()?;
            return Some(FileSystemPath::new_normalized_unchecked(
                ResolvedVc::upcast(*fs),
                RcStr::from(sys_to_unix(relative)),
            ));
        }
        None
    }
}

#[turbo_tasks::function]
pub fn disk_file_system_map(
    entries: Vec<(RcStr, ResolvedVc<DiskFileSystem>)>,
) -> Vc<DiskFileSystemMap> {
    DiskFileSystemMap(entries).cell()
}

#[turbo_tasks::function(operation)]
pub fn empty_disk_file_system_map_operation() -> Vc<DiskFileSystemMap> {
    DiskFileSystemMap(Vec::new()).cell()
}

pub fn empty_disk_file_system_map() -> OperationVc<DiskFileSystemMap> {
    empty_disk_file_system_map_operation()
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use turbo_rcstr::rcstr;
    use turbo_tasks::Vc;

    use super::DiskFileSystemMap;
    use crate::DiskFileSystem;

    #[turbo_tasks::function(operation, root)]
    async fn assert_component_safe_lookup() -> anyhow::Result<()> {
        let fs = DiskFileSystem::new(rcstr!("root"), Vc::cell(rcstr!("/tmp/root")))
            .to_resolved()
            .await?;
        let map = DiskFileSystemMap(vec![(rcstr!("/tmp/root"), fs)]);
        assert_eq!(
            map.lookup(Path::new("/tmp/root/file")).unwrap().path,
            "file"
        );
        assert!(map.lookup(Path::new("/tmp/root-other/file")).is_none());
        Ok(())
    }

    #[tokio::test]
    async fn component_safe_lookup() {
        use turbo_tasks_backend::{BackendOptions, TurboTasksBackend, noop_backing_storage};

        let tt = turbo_tasks::TurboTasks::new(TurboTasksBackend::new(
            BackendOptions::default(),
            noop_backing_storage(),
        ));
        tt.run_once(async {
            assert_component_safe_lookup()
                .read_strongly_consistent()
                .await
        })
        .await
        .unwrap();
    }
}

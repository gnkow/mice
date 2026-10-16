import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { RequireAuth } from './components/RequireAuth'
import { RequireAuthz } from './components/RequireAuthz'
import { RepoIndexRedirect, RepoLayout } from './components/RepoLayout'
import { BlobPage } from './pages/BlobPage'
import { BranchesPage } from './pages/BranchesPage'
import { CommitsPage } from './pages/CommitsPage'
import { ComparePage } from './pages/ComparePage'
import { DataFrameComparePage } from './pages/DataFrameComparePage'
import { DataFramePage } from './pages/DataFramePage'
import { DocsPage } from './pages/DocsPage'
import { HomePage } from './pages/HomePage'
import { ImportExportPage } from './pages/ImportExportPage'
import { LargeUploadPage } from './pages/LargeUploadPage'
import { AuditPage } from './pages/AuditPage'
import { LoginPage } from './pages/LoginPage'
import { PendingAccessPage } from './pages/PendingAccessPage'
import { MergePage } from './pages/MergePage'
import { NamespaceSettingsPage } from './pages/NamespaceSettingsPage'
import { NamespacePage } from './pages/NamespacePage'
import { NamespacesListPage } from './pages/NamespacesListPage'
import { NewNamespacePage } from './pages/NewNamespacePage'
import { NewRepoPage } from './pages/NewRepoPage'
import { RepositoriesListPage } from './pages/RepositoriesListPage'
import { RepoSettingsPage } from './pages/RepoSettingsPage'
import { SettingsPage } from './pages/SettingsPage'
import { TreePage } from './pages/TreePage'
import { WorkspacePage } from './pages/WorkspacePage'
import { WorkspacesListPage } from './pages/WorkspacesListPage'
import { WorkspacesPage } from './pages/WorkspacesPage'
import { JobPage } from './pages/JobPage'
import { JobsPage } from './pages/JobsPage'
import { JobsListPage } from './pages/JobsListPage'
import './App.css'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="pending" element={<PendingAccessPage />} />
          <Route element={<RequireAuthz />}>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="namespaces" element={<NamespacesListPage />} />
              <Route path="namespaces/new" element={<NewNamespacePage />} />
              <Route path="repositories" element={<RepositoriesListPage />} />
              <Route
                path="projects"
                element={<Navigate to="/repositories" replace />}
              />
              <Route path="workspaces" element={<WorkspacesListPage />} />
              <Route path="jobs" element={<JobsListPage />} />
              <Route path="audit" element={<AuditPage />} />
              <Route path="docs" element={<DocsPage />} />
              <Route path="n/:namespace" element={<NamespacePage />} />
              <Route
                path="n/:namespace/settings"
                element={<NamespaceSettingsPage />}
              />
              <Route
                path="n/:namespace/access"
                element={<Navigate to="../settings" relative="path" replace />}
              />
              <Route path="n/:namespace/r/:repo" element={<RepoLayout />}>
                <Route index element={<RepoIndexRedirect />} />
                <Route path="tree/:branch/*" element={<TreePage />} />
                <Route path="tree/:branch" element={<TreePage />} />
                <Route path="blob/:branch/*" element={<BlobPage />} />
                <Route path="branches" element={<BranchesPage />} />
                <Route path="commits" element={<CommitsPage />} />
                <Route path="commits/:commitId" element={<CommitsPage />} />
                <Route path="compare" element={<ComparePage />} />
                <Route path="df-compare" element={<DataFrameComparePage />} />
                <Route path="merge" element={<MergePage />} />
                <Route path="settings" element={<RepoSettingsPage />} />
                <Route path="workspaces" element={<WorkspacesPage />} />
                <Route
                  path="workspaces/:workspaceId"
                  element={<WorkspacePage />}
                />
                <Route path="jobs" element={<JobsPage />} />
                <Route path="jobs/:jobId" element={<JobPage />} />
                <Route path="df/:branch/*" element={<DataFramePage />} />
                <Route path="import" element={<ImportExportPage />} />
                <Route path="upload" element={<LargeUploadPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
              <Route path="repos/new" element={<NewRepoPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

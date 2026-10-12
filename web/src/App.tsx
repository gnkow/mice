import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { RepoIndexRedirect, RepoLayout } from './components/RepoLayout'
import { BlobPage } from './pages/BlobPage'
import { BranchesPage } from './pages/BranchesPage'
import { CommitPage } from './pages/CommitPage'
import { CommitsPage } from './pages/CommitsPage'
import { ComparePage } from './pages/ComparePage'
import { DataFrameComparePage } from './pages/DataFrameComparePage'
import { DataFramePage } from './pages/DataFramePage'
import { DocsPage } from './pages/DocsPage'
import { HomePage } from './pages/HomePage'
import { ImportExportPage } from './pages/ImportExportPage'
import { LargeUploadPage } from './pages/LargeUploadPage'
import { MergePage } from './pages/MergePage'
import { NamespacePage } from './pages/NamespacePage'
import { NamespacesListPage } from './pages/NamespacesListPage'
import { NewRepoPage } from './pages/NewRepoPage'
import { ProjectsListPage } from './pages/ProjectsListPage'
import { RepoSettingsPage } from './pages/RepoSettingsPage'
import { SettingsPage } from './pages/SettingsPage'
import { TreePage } from './pages/TreePage'
import { WorkspacePage } from './pages/WorkspacePage'
import { WorkspacesListPage } from './pages/WorkspacesListPage'
import { WorkspacesPage } from './pages/WorkspacesPage'
import './App.css'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="namespaces" element={<NamespacesListPage />} />
          <Route path="projects" element={<ProjectsListPage />} />
          <Route path="workspaces" element={<WorkspacesListPage />} />
          <Route path="docs" element={<DocsPage />} />
          <Route path="n/:namespace" element={<NamespacePage />} />
          <Route path="n/:namespace/r/:repo" element={<RepoLayout />}>
            <Route index element={<RepoIndexRedirect />} />
            <Route path="tree/:branch/*" element={<TreePage />} />
            <Route path="tree/:branch" element={<TreePage />} />
            <Route path="blob/:branch/*" element={<BlobPage />} />
            <Route path="branches" element={<BranchesPage />} />
            <Route path="commits" element={<CommitsPage />} />
            <Route path="commits/:commitId" element={<CommitPage />} />
            <Route path="compare" element={<ComparePage />} />
            <Route path="df-compare" element={<DataFrameComparePage />} />
            <Route path="merge" element={<MergePage />} />
            <Route path="settings" element={<RepoSettingsPage />} />
            <Route path="workspaces" element={<WorkspacesPage />} />
            <Route
              path="workspaces/:workspaceId"
              element={<WorkspacePage />}
            />
            <Route path="df/:branch/*" element={<DataFramePage />} />
            <Route path="import" element={<ImportExportPage />} />
            <Route path="upload" element={<LargeUploadPage />} />
          </Route>
          <Route path="repos/new" element={<NewRepoPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

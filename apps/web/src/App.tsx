import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { CockpitPage } from "./pages/CockpitPage";
import { EditProjectPage } from "./pages/EditProjectPage";
import { EditRequirementPage } from "./pages/EditRequirementPage";
import { GraphPage } from "./pages/GraphPage";
import { NewProjectPage } from "./pages/NewProjectPage";
import { NewRequirementPage } from "./pages/NewRequirementPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ReleasePage } from "./pages/ReleasePage";
import { WorkItemPage } from "./pages/WorkItemPage";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<CockpitPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/new" element={<NewProjectPage />} />
        <Route path="projects/:projectId/edit" element={<EditProjectPage />} />
        <Route path="requirements/:requirementId/graph" element={<GraphPage />} />
        <Route path="requirements/:requirementId/edit" element={<EditRequirementPage />} />
        <Route path="work-items/:workItemId" element={<WorkItemPage />} />
        <Route path="releases" element={<ReleasePage />} />
        <Route path="requirements/new" element={<NewRequirementPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

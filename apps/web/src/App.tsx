import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { CockpitPage } from "./pages/CockpitPage";
import { GraphPage } from "./pages/GraphPage";
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
        <Route path="requirements/:requirementId/graph" element={<GraphPage />} />
        <Route path="work-items/:workItemId" element={<WorkItemPage />} />
        <Route path="releases" element={<ReleasePage />} />
        <Route path="graph" element={<Navigate to="/requirements/req-42/graph" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

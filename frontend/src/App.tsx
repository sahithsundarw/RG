import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { RepositoryList } from "./pages/RepositoryList";
import { Dashboard } from "./pages/Dashboard";
import { MonitoredRepos } from "./pages/MonitoredRepos";

export const App: React.FC = () => (
  <ThemeProvider>
    <BrowserRouter>
      <div style={{ minHeight: "100vh", background: "var(--bg)", transition: "background 0.2s ease" }}>
        <Routes>
          <Route path="/" element={<RepositoryList />} />
          <Route path="/repo/:repoId" element={<Dashboard />} />
          <Route path="/repos" element={<MonitoredRepos />} />
        </Routes>
      </div>
    </BrowserRouter>
  </ThemeProvider>
);

export default App;

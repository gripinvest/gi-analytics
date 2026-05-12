import AssetSearchDashboard from "./AssetSearchDashboard";
import GenericDashboard from "./GenericDashboard";

/* Registry: project.json's `dashboard_component` key -> component.
   Add a new project's dashboard here; anything unmatched falls back to GenericDashboard. */
export const DASHBOARDS = {
  AssetSearch: AssetSearchDashboard,
};

export function getDashboard(key) {
  return (key && DASHBOARDS[key]) || GenericDashboard;
}

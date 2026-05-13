import AssetSearchDashboard from "./AssetSearchDashboard";
import AssetSearchDashboardEditorial from "./AssetSearchDashboardEditorial";
import GenericDashboard from "./GenericDashboard";

/* Registry: project.json's `dashboard_component` key -> { classic, editorial }.
   Each project can ship one or both renderings. The project page picks the
   variant matching the current design from useDesign(). Anything unmatched
   falls back to GenericDashboard in both modes. */
export const DASHBOARDS = {
  AssetSearch: {
    classic: AssetSearchDashboard,
    editorial: AssetSearchDashboardEditorial,
  },
};

export function getDashboard(key, design = "classic") {
  const entry = key && DASHBOARDS[key];
  if (!entry) return GenericDashboard;
  return entry[design] || entry.classic || GenericDashboard;
}

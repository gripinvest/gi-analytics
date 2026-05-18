import AssetSearchDashboard from "./AssetSearchDashboard";
import AssetSearchDashboardEditorial from "./AssetSearchDashboardEditorial";
import GripConnectDashboardEditorial from "./GripConnectDashboardEditorial";
import GenericDashboard from "./GenericDashboard";
import FraYoutubeDashboard from "./FraYoutubeDashboard";

/* Registry: project.json's `dashboard_component` key -> { classic, editorial }.
   Each project can ship one or both renderings. The project page picks the
   variant matching the current design from useDesign(). Anything unmatched
   falls back to GenericDashboard in both modes.

   GripConnect ships an editorial rendering only — classic falls through to
   GenericDashboard (table list + ad-hoc SQL). Editorial is the product
   default, so that's what nearly every viewer gets. */
export const DASHBOARDS = {
  AssetSearch: {
    classic: AssetSearchDashboard,
    editorial: AssetSearchDashboardEditorial,
  },
  GripConnect: {
    editorial: GripConnectDashboardEditorial,
  },
  FraYoutube: {
    classic: FraYoutubeDashboard,
  },
};

export function getDashboard(key, design = "classic") {
  const entry = key && DASHBOARDS[key];
  if (!entry) return GenericDashboard;
  return entry[design] || entry.classic || GenericDashboard;
}

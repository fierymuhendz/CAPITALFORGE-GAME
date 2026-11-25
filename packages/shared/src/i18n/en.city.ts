import type { Dict } from "./index";

export const enCity: Dict = {
  city3d: {
    status: {
      working: "working",
      idle: "idle, waiting for work",
      stalled: "stalled, needs attention",
      constructing: "under construction",
      upgrading: "upgrading",
    },
    chip: { idle: "Idle", stalled: "Stalled" },
    mine: "mine",
    forSale: "plot for sale",
    to: "to",
    cargo: "cargo",
    chipLabel: "{type}, {status}",
  },
};

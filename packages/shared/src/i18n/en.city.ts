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
    to: "to",
    chipLabel: "{type}, {status}",
  },
};

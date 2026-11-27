import type { Dict } from "./index";

export const trCity: Dict = {
  city3d: {
    status: {
      working: "çalışıyor",
      idle: "boşta, iş bekliyor",
      stalled: "durdu, müdahale gerekli",
      constructing: "inşaatta",
      upgrading: "yükseltiliyor",
    },
    chip: { idle: "Boşta", stalled: "Durdu" },
    to: "hedef",
    chipLabel: "{type}, {status}",
  },
};

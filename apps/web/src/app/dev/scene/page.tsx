import { notFound } from "next/navigation";
import DevScene from "./DevScene";

export const dynamic = "force-dynamic";

/** Geliştirme sayfası: üretimde 404. */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DevScene />;
}

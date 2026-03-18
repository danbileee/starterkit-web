import { data } from "react-router";
import type { Route } from "./+types/health";

export function loader(_: Route.LoaderArgs) {
  return data(
    { status: "ok" } satisfies { status: string },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
}

export const Component = () => null;

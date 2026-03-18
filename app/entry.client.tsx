import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import * as Sentry from "@sentry/react";

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
    {
      onUncaughtError: (error, errorInfo) => {
        Sentry.captureException(error, { extra: { componentStack: errorInfo.componentStack } });
      },
      onCaughtError: (error) => {
        Sentry.captureException(error);
      },
      onRecoverableError: (error) => {
        Sentry.captureException(error);
      },
    },
  );
});

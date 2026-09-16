"use client";

import { useEffect } from "react";
import { Empty } from "@/features/organizer/components/portal-ui";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Empty
      title="Something went wrong"
      detail="This part of the organizer workspace hit an unexpected error. You can try again, or reload the page."
      action="Try again"
      onAction={reset}
    />
  );
}

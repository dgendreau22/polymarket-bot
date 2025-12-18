import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center">
      <AlertCircle className="w-12 h-12 text-destructive mb-4" />
      <h1 className="text-xl font-semibold mb-2">Market Not Found</h1>
      <p className="text-muted-foreground mb-6">
        The requested market could not be found.
      </p>
      <Link href="/dashboard">
        <Button>Return to Dashboard</Button>
      </Link>
    </div>
  );
}

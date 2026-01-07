"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface CountdownProps {
  targetDate: Date;
  className?: string;
}

export function Countdown({ targetDate, className }: CountdownProps) {
  const [timeLeft, setTimeLeft] = useState<{
    hours: number;
    minutes: number;
    seconds: number;
    isExpired: boolean;
    isWarning: boolean;
  } | null>(null);

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const target = new Date(targetDate).getTime();
      const diff = target - now;

      if (diff <= 0) {
        return { hours: 0, minutes: 0, seconds: 0, isExpired: true, isWarning: false };
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      const isWarning = diff < 5 * 60 * 1000; // Less than 5 minutes

      return { hours, minutes, seconds, isExpired: false, isWarning };
    };

    // Initial calculation
    setTimeLeft(calculateTimeLeft());

    // Update every second
    const interval = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);

    return () => clearInterval(interval);
  }, [targetDate]);

  if (!timeLeft) return null;

  if (timeLeft.isExpired) {
    return (
      <span className={cn("text-xs text-red-500", className)}>
        Market closed
      </span>
    );
  }

  const formatTime = () => {
    const parts: string[] = [];
    if (timeLeft.hours > 0) parts.push(`${timeLeft.hours}h`);
    if (timeLeft.minutes > 0 || timeLeft.hours > 0) parts.push(`${timeLeft.minutes}m`);
    parts.push(`${timeLeft.seconds}s`);
    return parts.join(" ");
  };

  return (
    <span
      className={cn(
        "text-xs",
        timeLeft.isWarning ? "text-red-500" : "text-muted-foreground",
        className
      )}
    >
      Closes in {formatTime()}
    </span>
  );
}

"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const WARNING_THRESHOLD_MS = 5 * MS_PER_MINUTE;

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

      const hours = Math.floor(diff / MS_PER_HOUR);
      const minutes = Math.floor((diff % MS_PER_HOUR) / MS_PER_MINUTE);
      const seconds = Math.floor((diff % MS_PER_MINUTE) / MS_PER_SECOND);
      const isWarning = diff < WARNING_THRESHOLD_MS;

      return { hours, minutes, seconds, isExpired: false, isWarning };
    };

    // Initial calculation
    setTimeLeft(calculateTimeLeft());

    // Update every second
    const interval = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, MS_PER_SECOND);

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

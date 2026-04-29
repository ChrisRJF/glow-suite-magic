import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

/**
 * Global GlowSuite Switch.
 * Track: 48x26, Thumb: 22x22, padding 2px.
 * Off: translateX(2px). On: translateX(22px). 200ms ease-in-out.
 * Active: purple gradient + subtle glow. Inactive: light grey.
 * Fixed size — never stretches inside flex containers.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    ref={ref}
    style={{ width: 48, height: 26, flex: "0 0 48px" }}
    className={cn(
      "relative inline-flex shrink-0 grow-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=unchecked]:bg-muted",
      "data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-primary data-[state=checked]:to-[#C850C0]",
      "data-[state=checked]:shadow-[0_0_0_1px_hsl(var(--primary)/0.15),0_4px_12px_-2px_hsl(var(--primary)/0.35)]",
      className,
    )}
    {...props}
  >
    <SwitchPrimitives.Thumb
      style={{ width: 22, height: 22 }}
      className={cn(
        "pointer-events-none block rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] ring-0 transition-transform duration-200 ease-in-out",
        "data-[state=checked]:translate-x-[22px] data-[state=unchecked]:translate-x-[2px]",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };

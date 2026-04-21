import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium leading-none ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.97] active:translate-y-[0.5px]",
  {
    variants: {
      variant: {
        default:
          "btn-shine bg-primary text-primary-foreground hover:bg-primary/92 rounded-xl shadow-[0_1px_2px_hsl(var(--primary)/0.25),0_4px_12px_-4px_hsl(var(--primary)/0.35)] hover:shadow-[0_2px_4px_hsl(var(--primary)/0.3),0_8px_20px_-6px_hsl(var(--primary)/0.4)]",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-xl shadow-[0_1px_2px_hsl(var(--destructive)/0.2)]",
        outline:
          "border border-border bg-card hover:bg-secondary text-foreground rounded-xl shadow-[var(--shadow-xs)]",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-xl",
        ghost: "hover:bg-secondary text-muted-foreground hover:text-foreground rounded-xl",
        link: "text-primary underline-offset-4 hover:underline",
        gradient:
          "btn-shine gradient-bg text-primary-foreground hover:opacity-95 rounded-xl shadow-[0_2px_6px_hsl(var(--glow-purple)/0.3),0_8px_20px_-6px_hsl(var(--glow-purple)/0.4)]",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-9 rounded-xl px-3.5 text-xs",
        lg: "h-12 rounded-xl px-8 text-base",
        icon: "h-10 w-10 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

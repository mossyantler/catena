import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Toggle as TogglePrimitive } from "radix-ui"

const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-lg text-sm font-medium whitespace-nowrap transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-accent aria-pressed:text-strong data-[state=on]:bg-accent data-[state=on]:text-strong dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-transparent hover:bg-muted",
        // Filter chips (2026-11-07): a hairline box; the picked one fills and its edge firms up.
        chip: "border border-border bg-transparent text-foreground hover:bg-accent data-[state=on]:border-input",
        // The drafts' segmented track: the picked one fills inside a faint track (home 할 일, upcoming 종류).
        segment: "rounded-sm bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-input max-lg:rounded-md",
        // The drafts' boxed pair (the timeline's 7일 / 4주): one hairline box, a line between, the picked one fills.
        box: "bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-accent",
      },
      size: {
        default:
          "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-7 min-w-7 rounded-[min(var(--radius-md),12px)] px-2.5 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        // 36px on phones, as the second draft draws the phone's filter chips.
        chip: "h-7 gap-1.5 px-2.5 text-xs max-lg:h-9 max-lg:px-3",
        segment: "h-6.5 px-3 text-xs max-lg:h-9.5 max-lg:text-sm",
        box: "h-7 px-3 text-xs max-lg:h-11 max-lg:min-w-13",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  // The drafts' alert (Services-Desktop/Phone): a tinted box, the icon beside a bold title and its text, the action at the
  // right (desktop, centred) or under the text (phone).
  "group/alert relative grid w-full gap-x-2.5 gap-y-1 rounded-xl border p-3.5 text-left text-sm has-[>svg]:grid-cols-[1rem_minmax(0,1fr)] lg:gap-x-3 lg:px-4 lg:has-data-[slot=alert-action]:grid-cols-[1rem_minmax(0,1fr)_auto] *:[svg]:row-span-2 *:[svg]:mt-0.75 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive: "border-fail/35 bg-fail/8 *:[svg]:text-fail",
        // Something late or failing that waits on no one (2026-11-07): orange, not red.
        warning: "border-wait/35 bg-wait/8 *:[svg]:text-wait",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-semibold text-strong group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm text-pretty text-foreground group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("col-start-2 justify-self-start max-lg:mt-1 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:self-center", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }

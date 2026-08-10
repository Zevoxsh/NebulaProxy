import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * AdminCard - Card component with admin theme styling
 */
export function AdminCard({ className, ...props }) {
  return (
    <Card
      className={cn(
        "bg-admin-surface border-admin-border text-admin-text",
        className
      )}
      {...props}
    />
  )
}

/**
 * AdminCardHeader - Card header with admin theme
 */
export function AdminCardHeader({ className, ...props }) {
  return (
    <CardHeader
      className={cn("border-b border-admin-border pb-4", className)}
      {...props}
    />
  )
}

/**
 * AdminCardTitle - Card title with admin theme
 */
export function AdminCardTitle({ className, ...props }) {
  return (
    <CardTitle
      className={cn("text-admin-text font-semibold text-lg", className)}
      {...props}
    />
  )
}

/**
 * AdminCardDescription - Card description with admin theme
 */
export function AdminCardDescription({ className, ...props }) {
  return (
    <CardDescription
      className={cn("text-admin-text-muted text-sm", className)}
      {...props}
    />
  )
}

/**
 * AdminCardContent - Card content with admin theme
 */
export function AdminCardContent({ className, ...props }) {
  return (
    <CardContent
      className={cn("text-admin-text", className)}
      {...props}
    />
  )
}

/**
 * AdminCardFooter - Card footer with admin theme
 */
export function AdminCardFooter({ className, ...props }) {
  return (
    <CardFooter
      className={cn("border-t border-admin-border pt-4", className)}
      {...props}
    />
  )
}

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * AdminBadge - Badge component with admin theme variants
 * @param {Object} props
 * @param {string} props.variant - Badge variant (default, success, warning, danger, secondary, outline)
 */
export function AdminBadge({ variant = "default", className, ...props }) {
  const variants = {
    default: "bg-admin-primary/20 border-admin-primary/40 text-admin-primary",
    success: "bg-admin-success/20 border-admin-success/40 text-green-200",
    warning: "bg-admin-warning/20 border-admin-warning/40 text-yellow-200",
    danger: "bg-admin-danger/20 border-admin-danger/40 text-red-200",
    secondary: "bg-admin-border/50 border-admin-border text-admin-text-muted",
    outline: "border-admin-border text-admin-text-muted bg-transparent",
    active: "bg-admin-success/20 border-admin-success/40 text-green-200",
    inactive: "bg-admin-text-subtle/20 border-admin-text-subtle/40 text-admin-text-muted",
    pending: "bg-admin-warning/20 border-admin-warning/40 text-yellow-200"
  }

  return (
    <Badge
      className={cn(
        "border font-medium",
        variants[variant] || variants.default,
        className
      )}
      {...props}
    />
  )
}

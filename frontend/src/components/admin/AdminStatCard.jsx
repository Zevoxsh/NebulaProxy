import { AdminCard, AdminCardContent } from "./AdminCard"
import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"

/**
 * AdminStatCard - Statistics card component for admin dashboard
 * @param {Object} props
 * @param {string} props.title - Card title
 * @param {string|number} props.value - Main value to display
 * @param {string} props.subtitle - Subtitle or description
 * @param {React.ReactNode} props.icon - Icon component
 * @param {string} props.trend - Trend direction ('up', 'down', 'neutral')
 * @param {string} props.trendValue - Trend value (e.g., '+12%', '-5%')
 */
export function AdminStatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendValue,
  className,
  ...props
}) {
  const trendIcons = {
    up: TrendingUp,
    down: TrendingDown,
    neutral: Minus
  }

  const trendColors = {
    up: "text-admin-success",
    down: "text-admin-danger",
    neutral: "text-admin-text-muted"
  }

  const TrendIcon = trend ? trendIcons[trend] : null

  return (
    <AdminCard className={cn("relative overflow-hidden", className)} {...props}>
      <AdminCardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-admin-text-muted text-sm font-medium mb-1">
              {title}
            </p>
            <h3 className="text-admin-text text-3xl font-bold mb-2">
              {value}
            </h3>
            {subtitle && (
              <p className="text-admin-text-muted text-xs">
                {subtitle}
              </p>
            )}
            {trend && trendValue && (
              <div className={cn("flex items-center gap-1 mt-2 text-sm font-medium", trendColors[trend])}>
                {TrendIcon && <TrendIcon className="h-4 w-4" />}
                <span>{trendValue}</span>
              </div>
            )}
          </div>
          {Icon && (
            <div className="rounded-lg bg-admin-primary/10 p-3">
              <Icon className="h-6 w-6 text-admin-primary" />
            </div>
          )}
        </div>
      </AdminCardContent>
    </AdminCard>
  )
}

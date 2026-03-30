import { useState, useMemo } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { AdminButton } from "./AdminButton"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowUpDown, ArrowUp, ArrowDown, Search } from "lucide-react"

/**
 * AdminTable - Advanced data table component with sorting, filtering, and pagination
 *
 * @param {Object} props
 * @param {Array} props.columns - Column definitions [{accessorKey, header, cell, sortable}]
 * @param {Array} props.data - Table data
 * @param {boolean} props.isLoading - Loading state
 * @param {Function} props.onRowClick - Row click handler
 * @param {boolean} props.searchable - Enable global search (default: true)
 * @param {boolean} props.pagination - Enable pagination (default: true)
 * @param {number} props.pageSize - Items per page (default: 25)
 * @param {string} props.emptyMessage - Message when no data
 */
export function AdminTable({
  columns = [],
  data = [],
  isLoading = false,
  onRowClick,
  searchable = true,
  pagination = true,
  pageSize: initialPageSize = 25,
  emptyMessage = "No data available",
  className,
  ...props
}) {
  const [searchQuery, setSearchQuery] = useState("")
  const [sortConfig, setSortConfig] = useState({ key: null, direction: null })
  const [currentPage, setCurrentPage] = useState(0)
  const [pageSize, setPageSize] = useState(initialPageSize)

  // Filter data based on search query
  const filteredData = useMemo(() => {
    if (!searchQuery || !searchable) return data

    return data.filter((row) => {
      return columns.some((column) => {
        const value = row[column.accessorKey]
        return value?.toString().toLowerCase().includes(searchQuery.toLowerCase())
      })
    })
  }, [data, searchQuery, columns, searchable])

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortConfig.key) return filteredData

    return [...filteredData].sort((a, b) => {
      const aValue = a[sortConfig.key]
      const bValue = b[sortConfig.key]

      if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1
      if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1
      return 0
    })
  }, [filteredData, sortConfig])

  // Paginate data
  const paginatedData = useMemo(() => {
    if (!pagination) return sortedData

    const start = currentPage * pageSize
    const end = start + pageSize
    return sortedData.slice(start, end)
  }, [sortedData, currentPage, pageSize, pagination])

  const totalPages = Math.ceil(sortedData.length / pageSize)

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key !== key) return { key, direction: "asc" }
      if (prev.direction === "asc") return { key, direction: "desc" }
      return { key: null, direction: null }
    })
  }

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return <ArrowUpDown className="h-4 w-4" />
    if (sortConfig.direction === "asc") return <ArrowUp className="h-4 w-4" />
    return <ArrowDown className="h-4 w-4" />
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full bg-admin-border" />
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full bg-admin-border" />
        ))}
      </div>
    )
  }

  return (
    <div className={cn("space-y-4", className)} {...props}>
      {/* Search bar */}
      {searchable && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-admin-text-subtle" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setCurrentPage(0) // Reset to first page on search
              }}
              className="pl-9 bg-admin-bg border-admin-border text-admin-text placeholder:text-admin-text-subtle focus:border-admin-primary"
            />
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-admin-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-admin-surface2 border-admin-border hover:bg-admin-surface2">
              {columns.map((column) => (
                <TableHead
                  key={column.accessorKey}
                  className={cn(
                    "text-admin-text font-semibold",
                    column.sortable && "cursor-pointer select-none"
                  )}
                  onClick={() => column.sortable && handleSort(column.accessorKey)}
                >
                  <div className="flex items-center gap-2">
                    {column.header}
                    {column.sortable && getSortIcon(column.accessorKey)}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-center text-admin-text-muted py-12"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((row, rowIndex) => (
                <TableRow
                  key={rowIndex}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    "border-admin-border bg-admin-surface hover:bg-admin-surface2",
                    onRowClick && "cursor-pointer"
                  )}
                >
                  {columns.map((column) => (
                    <TableCell
                      key={column.accessorKey}
                      className="text-admin-text"
                    >
                      {column.cell
                        ? column.cell({ row: { original: row } })
                        : row[column.accessorKey]}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {pagination && sortedData.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-admin-text-muted">
            Showing {currentPage * pageSize + 1} to{" "}
            {Math.min((currentPage + 1) * pageSize, sortedData.length)} of{" "}
            {sortedData.length} results
          </div>

          <div className="flex items-center gap-2">
            <AdminButton
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(0)}
              disabled={currentPage === 0}
            >
              <ChevronsLeft className="h-4 w-4" />
            </AdminButton>
            <AdminButton
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((prev) => Math.max(0, prev - 1))}
              disabled={currentPage === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </AdminButton>

            <span className="text-sm text-admin-text px-4">
              Page {currentPage + 1} of {totalPages}
            </span>

            <AdminButton
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1))}
              disabled={currentPage >= totalPages - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </AdminButton>
            <AdminButton
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(totalPages - 1)}
              disabled={currentPage >= totalPages - 1}
            >
              <ChevronsRight className="h-4 w-4" />
            </AdminButton>
          </div>
        </div>
      )}
    </div>
  )
}

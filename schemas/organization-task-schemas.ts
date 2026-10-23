import { TaskPriority, TaskStatus } from "@/lib/db/enums";
import { z } from "zod/v4";

// List tasks with filters and pagination
export const listTasksSchema = z.object({
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
  query: z.string().optional(),
  sortBy: z.enum(["title", "status", "priority", "dueDate", "createdAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
  filters: z.object({
    status: z.array(z.nativeEnum(TaskStatus)).optional(),
    priority: z.array(z.nativeEnum(TaskPriority)).optional(),
  }).optional(),
});

// Create task
export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
  description: z.string().trim().max(5000, "Description is too long").optional(),
  status: z.nativeEnum(TaskStatus).default(TaskStatus.todo),
  priority: z.nativeEnum(TaskPriority).default(TaskPriority.medium),
  dueDate: z.date().optional(),
  assignedToId: z.string().uuid().optional(),
});

// Update task
export const updateTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).optional().nullable(),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  dueDate: z.date().optional().nullable(),
  assignedToId: z.string().uuid().optional().nullable(),
});

// Delete task
export const deleteTaskSchema = z.object({
  id: z.string().uuid(),
});

// Type exports
export type ListTasksInput = z.infer<typeof listTasksSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type DeleteTaskInput = z.infer<typeof deleteTaskSchema>;
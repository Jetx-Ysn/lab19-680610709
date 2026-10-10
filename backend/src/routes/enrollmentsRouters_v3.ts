import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { zEnrollmentBody } from "../libs/zodValidators.ts";

import type { CustomRequest } from "../libs/types.ts";

// import authentication middleware
import { authenticateToken } from "../middlewares/authenMiddleware.ts";
import { checkRoles } from "../middlewares/checkRolesDBMiddleware.ts";

// import database
import { PrismaClient } from "../../generated/prisma/client.ts";
const prisma = new PrismaClient();

const router = Router();

// Zod validator for PUT enrollment (change course)
const zEnrollmentPutBody = z.object({
  studentId: z.string(),
  courseId: z.string(),
  newCourseId: z.string(),
});

// GET /api/v3/enrollments
// ADMIN: get all enrollments, STUDENT: get only his own enrollments
router.get(
  "/",
  authenticateToken,
  checkRoles,
  async (req: CustomRequest, res: Response) => {
    try {
      const user = req.user;
      const enrollments = await prisma.enrollment.findMany({
        where:
          user?.role === "STUDENT" ? { studentId: user.studentId ?? "" } : {},
        orderBy: { createdAt: "asc" },
      });

      return res.json({
        success: true,
        data: enrollments,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Something is wrong, please try again",
        error: err,
      });
    }
  },
);

// POST /api/v3/enrollments, body = {studentId, courseId}
router.post(
  "/",
  authenticateToken,
  checkRoles,
  async (req: CustomRequest, res: Response) => {
    try {
      const result = zEnrollmentBody.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: result.error.issues[0]?.message,
        });
      }
      const { studentId, courseId } = result.data;

      const user = req.user;
      if (user?.role === "STUDENT" && studentId !== user.studentId) {
        return res.status(403).json({
          success: false,
          message: "Forbidden access",
        });
      }

      const student = await prisma.student.findUnique({
        where: { studentId },
      });
      if (!student) {
        return res.status(404).json({
          success: false,
          message: `Student ${studentId} does not exists`,
        });
      }
      const course = await prisma.course.findUnique({ where: { courseId } });
      if (!course) {
        return res.status(404).json({
          success: false,
          message: `Course ${courseId} does not exists`,
        });
      }

      const enrolled = await prisma.enrollment.findFirst({
        where: { studentId, courseId },
      });
      if (enrolled) {
        return res.status(409).json({
          success: false,
          message: `Student ${studentId} has already enrolled in ${courseId}`,
        });
      }

      const created = await prisma.enrollment.create({
        data: { studentId, courseId },
      });

      return res.status(201).json({
        success: true,
        data: created,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Something is wrong, please try again",
        error: err,
      });
    }
  },
);

// PUT /api/v3/enrollments - เปลี่ยนวิชาที่ลงทะเบียนไว้ (courseId -> newCourseId)
router.put(
  "/",
  authenticateToken,
  checkRoles,
  async (req: CustomRequest, res: Response) => {
    try {
      const parseResult = zEnrollmentPutBody.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: parseResult.error.issues[0]?.message,
        });
      }

      const { studentId, courseId, newCourseId } = parseResult.data;
      const user = req.user;

      // Role ADMIN แก้ไขได้ทุกคน / Role STUDENT แก้ไขได้แค่ของตัวเอง (403)
      if (user?.role === "STUDENT" && studentId !== user.studentId) {
        return res.status(403).json({
          success: false,
          message: "Forbidden access",
        });
      }

      // วิชาใหม่ = วิชาเดิม (400)
      if (courseId === newCourseId) {
        return res.status(400).json({
          success: false,
          message: "New course cannot be the same as current course",
        });
      }

      // ยังไม่ได้ลงวิชาเดิม (404)
      const existingEnrollment = await prisma.enrollment.findFirst({
        where: { studentId, courseId },
      });
      if (!existingEnrollment) {
        return res.status(404).json({
          success: false,
          message: `Enrollment for course ${courseId} not found`,
        });
      }

      // วิชาใหม่ไม่มีจริง (404)
      const newCourse = await prisma.course.findUnique({
        where: { courseId: newCourseId },
      });
      if (!newCourse) {
        return res.status(404).json({
          success: false,
          message: `Course ${newCourseId} does not exist`,
        });
      }

      // ลงทะเบียนวิชาใหม่ไว้แล้ว (409)
      const alreadyEnrolledNew = await prisma.enrollment.findFirst({
        where: { studentId, courseId: newCourseId },
      });
      if (alreadyEnrolledNew) {
        return res.status(409).json({
          success: false,
          message: `Student already enrolled in ${newCourseId}`,
        });
      }

      // อัปเดตการลงทะเบียน
      await prisma.enrollment.updateMany({
        where: { studentId, courseId },
        data: { courseId: newCourseId },
      });

      const updated = await prisma.enrollment.findFirst({
        where: { studentId, courseId: newCourseId },
      });

      return res.status(200).json({
        success: true,
        message: "Enrollment updated successfully",
        data: updated,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Something is wrong, please try again",
        error: err,
      });
    }
  },
);

// DELETE /api/v3/enrollments - ยกเลิกการลงทะเบียน (drop)
router.delete(
  "/",
  authenticateToken,
  checkRoles,
  async (req: CustomRequest, res: Response) => {
    try {
      const { studentId, courseId } = req.body;
      if (!studentId || !courseId) {
        return res.status(400).json({
          success: false,
          message: "Validation failed: studentId and courseId are required",
        });
      }

      const user = req.user;
      // Role ADMIN ลบได้ทุกคน / Role STUDENT ลบได้แค่ของตัวเอง (403)
      if (user?.role === "STUDENT" && studentId !== user.studentId) {
        return res.status(403).json({
          success: false,
          message: "Forbidden access",
        });
      }

      // ไม่พบการลงทะเบียน (404)
      const existingEnrollment = await prisma.enrollment.findFirst({
        where: { studentId, courseId },
      });
      if (!existingEnrollment) {
        return res.status(404).json({
          success: false,
          message: "Enrollment not found",
        });
      }

      await prisma.enrollment.deleteMany({
        where: { studentId, courseId },
      });

      return res.status(200).json({
        success: true,
        message: "Enrollment deleted successfully",
        data: existingEnrollment,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Something is wrong, please try again",
        error: err,
      });
    }
  },
);

export default router;
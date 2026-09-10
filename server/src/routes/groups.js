import express from "express";
import pool from "../database.js";
import { authenticate } from "../middleware/auth.js";
import { addUserToRoom } from "../socket.js";

const router = express.Router();

router.use(authenticate);

const MAX_GROUPS_PER_USER = 50;
const MAX_MEMBERS_PER_GROUP = 100;

/**
 * POST /api/groups
 */
router.post("/", async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, memberIds } = req.body;
    const userId = req.user.id;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({
        error: "Invalid name",
        message: "Group name is required",
      });
    }

    const cleanName = name.trim();
    if (cleanName.length > 100) {
      return res.status(400).json({
        error: "Name too long",
        message: "Group name must be 100 characters or less",
      });
    }

    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({
        error: "Invalid members",
        message: "At least one member is required",
      });
    }

    const uniqueMemberIds = [
      ...new Set(
        memberIds
          .map((id) => parseInt(id, 10))
          .filter((id) => !isNaN(id) && id > 0 && id !== userId),
      ),
    ];

    if (uniqueMemberIds.length === 0) {
      return res.status(400).json({
        error: "Invalid members",
        message: "At least one valid member is required",
      });
    }

    // 🔒 حد أعضاء المجموعة
    if (uniqueMemberIds.length + 1 > MAX_MEMBERS_PER_GROUP) {
      return res.status(400).json({
        error: "Too many members",
        message: `A group can have at most ${MAX_MEMBERS_PER_GROUP} members`,
      });
    }

    // 🔒 حد عدد المجموعات لكل مستخدم
    const countResult = await client.query(
      `SELECT COUNT(*) as count FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
       WHERE cm.user_id = $1 AND c.type = 'group' AND cm.role = 'admin'`,
      [userId],
    );
    const adminGroupsCount = parseInt(countResult.rows[0].count, 10);

    if (adminGroupsCount >= MAX_GROUPS_PER_USER) {
      return res.status(400).json({
        error: "Group limit reached",
        message: `You can create at most ${MAX_GROUPS_PER_USER} groups`,
      });
    }

    const usersCheck = await client.query(
      `SELECT id FROM users WHERE id = ANY($1::int[])`,
      [uniqueMemberIds],
    );
    if (usersCheck.rows.length !== uniqueMemberIds.length) {
      return res.status(400).json({
        error: "Some users not found",
        message: "One or more selected users do not exist",
      });
    }

    await client.query("BEGIN");

    const convResult = await client.query(
      `INSERT INTO conversations (type, name, created_by)
       VALUES ('group', $1, $2)
       RETURNING id, name, created_at`,
      [cleanName, userId],
    );
    const conversationId = convResult.rows[0].id;

    const allMembers = [userId, ...uniqueMemberIds];

    const placeholders = [];
    const params = [conversationId];

    allMembers.forEach((memberId, index) => {
      const role = index === 0 ? "admin" : "member";
      params.push(memberId);
      const paramIndex = params.length;
      placeholders.push(`($1, $${paramIndex}, '${role}')`);
    });

    await client.query(
      `INSERT INTO conversation_members (conversation_id, user_id, role)
       VALUES ${placeholders.join(", ")}`,
      params,
    );

    await client.query("COMMIT");

    allMembers.forEach((memberId) => {
      addUserToRoom(memberId, `conversation:${conversationId}`);
    });

    res.status(201).json({
      id: conversationId,
      type: "group",
      name: cleanName,
      avatar: null,
      createdBy: userId,
      memberCount: allMembers.length,
      createdAt: convResult.rows[0].created_at,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Error creating group:", error.message);
    res.status(500).json({
      error: "Internal server error",
      message: "Unable to create group",
    });
  } finally {
    client.release();
  }
});

/**
 * GET /api/groups/:id
 */
router.get("/:id", async (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    const userId = req.user.id;

    if (isNaN(groupId) || groupId <= 0) {
      return res.status(400).json({
        error: "Invalid group ID",
        message: "Group ID must be a positive number",
      });
    }

    const membership = await pool.query(
      `SELECT role FROM conversation_members 
       WHERE conversation_id = $1 AND user_id = $2`,
      [groupId, userId],
    );
    if (membership.rows.length === 0) {
      return res.status(403).json({
        error: "Forbidden",
        message: "You are not a member of this group",
      });
    }

    const groupResult = await pool.query(
      `SELECT id, name, avatar, created_by, created_at 
       FROM conversations 
       WHERE id = $1 AND type = 'group'`,
      [groupId],
    );
    if (groupResult.rows.length === 0) {
      return res.status(404).json({
        error: "Group not found",
        message: "Group does not exist",
      });
    }

    const membersResult = await pool.query(
      `SELECT u.id, u.username, u.email, u.avatar, cm.role, cm.joined_at
       FROM conversation_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.conversation_id = $1
       ORDER BY cm.role DESC, u.username ASC`,
      [groupId],
    );

    const group = groupResult.rows[0];
    const myRole = membership.rows[0].role;

    res.json({
      id: group.id,
      name: group.name,
      avatar: group.avatar,
      createdBy: group.created_by,
      createdAt: group.created_at,
      myRole,
      members: membersResult.rows.map((m) => ({
        id: m.id,
        username: m.username,
        email: m.email,
        avatar: m.avatar,
        role: m.role,
        joinedAt: m.joined_at,
      })),
    });
  } catch (error) {
    console.error("Error fetching group:", error.message);
    res.status(500).json({
      error: "Internal server error",
      message: "Unable to fetch group",
    });
  }
});

/**
 * PUT /api/groups/:id
 */
router.put("/:id", async (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    const userId = req.user.id;
    const { name, avatar } = req.body;

    if (isNaN(groupId) || groupId <= 0) {
      return res.status(400).json({
        error: "Invalid group ID",
        message: "Group ID must be a positive number",
      });
    }

    const roleCheck = await pool.query(
      `SELECT role FROM conversation_members 
       WHERE conversation_id = $1 AND user_id = $2`,
      [groupId, userId],
    );
    if (roleCheck.rows.length === 0 || roleCheck.rows[0].role !== "admin") {
      return res.status(403).json({
        error: "Forbidden",
        message: "Only group admins can update the group",
      });
    }

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        return res.status(400).json({
          error: "Invalid name",
          message: "Group name cannot be empty",
        });
      }
      const cleanName = name.trim();
      if (cleanName.length > 100) {
        return res.status(400).json({
          error: "Name too long",
          message: "Group name must be 100 characters or less",
        });
      }
      updates.push(`name = $${paramIndex++}`);
      values.push(cleanName);
    }

    if (avatar !== undefined) {
      if (avatar === null) {
        updates.push(`avatar = NULL`);
      } else if (
        typeof avatar === "string" &&
        avatar.startsWith("data:image/")
      ) {
        // 🔒 رفض SVG
        const allowedPrefixes = [
          "data:image/png;",
          "data:image/jpeg;",
          "data:image/jpg;",
          "data:image/webp;",
          "data:image/gif;",
        ];
        if (!allowedPrefixes.some((prefix) => avatar.startsWith(prefix))) {
          return res.status(400).json({
            error: "Invalid avatar",
            message: "Only PNG, JPEG, WEBP, and GIF images are allowed",
          });
        }

        if (avatar.length > 7000000) {
          return res.status(400).json({
            error: "Image too large",
            message: "Image must be smaller than 5MB",
          });
        }
        updates.push(`avatar = $${paramIndex++}`);
        values.push(avatar);
      } else {
        return res.status(400).json({
          error: "Invalid avatar",
          message: "Avatar must be a valid image",
        });
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({
        error: "No changes",
        message: "No changes to update",
      });
    }

    values.push(groupId);
    const result = await pool.query(
      `UPDATE conversations SET ${updates.join(", ")} 
       WHERE id = $${paramIndex} AND type = 'group' 
       RETURNING id, name, avatar`,
      values,
    );

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation:${groupId}`).emit("group-updated", {
        id: groupId,
        name: result.rows[0].name,
        avatar: result.rows[0].avatar,
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating group:", error.message);
    res.status(500).json({
      error: "Internal server error",
      message: "Unable to update group",
    });
  }
});

/**
 * POST /api/groups/:id/members
 */
router.post("/:id/members", async (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    const userId = req.user.id;
    const { userIds } = req.body;

    if (isNaN(groupId) || groupId <= 0) {
      return res.status(400).json({
        error: "Invalid group ID",
        message: "Group ID must be a positive number",
      });
    }

    const roleCheck = await pool.query(
      `SELECT role FROM conversation_members 
       WHERE conversation_id = $1 AND user_id = $2`,
      [groupId, userId],
    );
    if (roleCheck.rows.length === 0 || roleCheck.rows[0].role !== "admin") {
      return res.status(403).json({
        error: "Forbidden",
        message: "Only group admins can add members",
      });
    }

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        error: "Invalid members",
        message: "At least one user ID is required",
      });
    }

    const uniqueIds = [
      ...new Set(
        userIds
          .map((id) => parseInt(id, 10))
          .filter((id) => !isNaN(id) && id > 0),
      ),
    ];

    // 🔒 حد أعضاء المجموعة
    const currentCount = await pool.query(
      `SELECT COUNT(*) as count FROM conversation_members WHERE conversation_id = $1`,
      [groupId],
    );
    const existingMembers = parseInt(currentCount.rows[0].count, 10);

    if (existingMembers + uniqueIds.length > MAX_MEMBERS_PER_GROUP) {
      return res.status(400).json({
        error: "Too many members",
        message: `A group can have at most ${MAX_MEMBERS_PER_GROUP} members`,
      });
    }

    const usersCheck = await pool.query(
      `SELECT id FROM users WHERE id = ANY($1::int[])`,
      [uniqueIds],
    );
    if (usersCheck.rows.length !== uniqueIds.length) {
      return res.status(400).json({
        error: "Some users not found",
        message: "One or more selected users do not exist",
      });
    }

    const addedIds = [];
    for (const memberId of uniqueIds) {
      const result = await pool.query(
        `INSERT INTO conversation_members (conversation_id, user_id, role)
         VALUES ($1, $2, 'member')
         ON CONFLICT (conversation_id, user_id) DO NOTHING
         RETURNING user_id`,
        [groupId, memberId],
      );
      if (result.rows.length > 0) {
        addedIds.push(memberId);
        addUserToRoom(memberId, `conversation:${groupId}`);
      }
    }

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation:${groupId}`).emit("group-updated", { id: groupId });
    }

    res.json({ added: addedIds });
  } catch (error) {
    console.error("Error adding members:", error.message);
    res.status(500).json({
      error: "Internal server error",
      message: "Unable to add members",
    });
  }
});

/**
 * DELETE /api/groups/:id/members/:userId
 */
router.delete("/:id/members/:userId", async (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    const targetUserId = parseInt(req.params.userId, 10);
    const userId = req.user.id;

    if (
      isNaN(groupId) ||
      groupId <= 0 ||
      isNaN(targetUserId) ||
      targetUserId <= 0
    ) {
      return res.status(400).json({
        error: "Invalid IDs",
        message: "Invalid group or user ID",
      });
    }

    if (targetUserId === userId) {
      return res.status(400).json({
        error: "Invalid action",
        message: "Use leave endpoint to remove yourself",
      });
    }

    const roleCheck = await pool.query(
      `SELECT role FROM conversation_members 
       WHERE conversation_id = $1 AND user_id = $2`,
      [groupId, userId],
    );
    if (roleCheck.rows.length === 0 || roleCheck.rows[0].role !== "admin") {
      return res.status(403).json({
        error: "Forbidden",
        message: "Only group admins can remove members",
      });
    }

    const result = await pool.query(
      `DELETE FROM conversation_members 
       WHERE conversation_id = $1 AND user_id = $2
       RETURNING user_id`,
      [groupId, targetUserId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Member not found",
        message: "User is not a member of this group",
      });
    }

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation:${groupId}`).emit("group-updated", { id: groupId });
    }

    res.json({ removed: targetUserId });
  } catch (error) {
    console.error("Error removing member:", error.message);
    res.status(500).json({
      error: "Internal server error",
      message: "Unable to remove member",
    });
  }
});

/**
 * POST /api/groups/:id/promote/:userId
 */
router.post("/:id/promote/:userId", async (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    const targetUserId = parseInt(req.params.userId, 10);
    const userId = req.user.id;

    if (
      isNaN(groupId) ||
      groupId <= 0 ||
      isNaN(targetUserId) ||
      targetUserId <= 0
    ) {
      return res.status(400).json({
        error: "Invalid IDs",
        message: "Invalid group or user ID",
      });
    }

    if (targetUserId === userId) {
      return res.status(400).json({
        error: "Invalid action",
        message: "Cannot promote yourself",
      });
    }

    const roleCheck = await pool.query(
      `SELECT role FROM conversation_members 
       WHERE conversation_id = $1 AND user_id = $2`,
      [groupId, userId],
    );
    if (roleCheck.rows.length === 0 || roleCheck.rows[0].role !== "admin") {
      return res.status(403).json({
        error: "Forbidden",
        message: "Only group admins can promote members",
      });
    }

    const targetCheck = await pool.query(
      `SELECT role FROM conversation_members 
       WHERE conversation_id = $1 AND user_id = $2`,
      [groupId, targetUserId],
    );
    if (targetCheck.rows.length === 0) {
      return res.status(404).json({
        error: "Member not found",
        message: "User is not a member of this group",
      });
    }

    if (targetCheck.rows[0].role === "admin") {
      return res.status(400).json({
        error: "Already admin",
        message: "User is already an admin",
      });
    }

    await pool.query(
      `UPDATE conversation_members SET role = 'admin' 
       WHERE conversation_id = $1 AND user_id = $2`,
      [groupId, targetUserId],
    );

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation:${groupId}`).emit("group-updated", { id: groupId });
    }

    res.json({ promoted: targetUserId });
  } catch (error) {
    console.error("Error promoting member:", error.message);
    res.status(500).json({
      error: "Internal server error",
      message: "Unable to promote member",
    });
  }
});

/**
 * POST /api/groups/:id/leave
 */
router.post("/:id/leave", async (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    const userId = req.user.id;

    if (isNaN(groupId) || groupId <= 0) {
      return res.status(400).json({
        error: "Invalid group ID",
        message: "Group ID must be a positive number",
      });
    }

    const membership = await pool.query(
      `SELECT role FROM conversation_members 
       WHERE conversation_id = $1 AND user_id = $2`,
      [groupId, userId],
    );
    if (membership.rows.length === 0) {
      return res.status(404).json({
        error: "Not a member",
        message: "You are not a member of this group",
      });
    }

    await pool.query(
      `DELETE FROM conversation_members 
       WHERE conversation_id = $1 AND user_id = $2`,
      [groupId, userId],
    );

    if (membership.rows[0].role === "admin") {
      const oldestMember = await pool.query(
        `SELECT user_id FROM conversation_members 
         WHERE conversation_id = $1 
         ORDER BY joined_at ASC LIMIT 1`,
        [groupId],
      );
      if (oldestMember.rows.length > 0) {
        await pool.query(
          `UPDATE conversation_members SET role = 'admin' 
           WHERE conversation_id = $1 AND user_id = $2`,
          [groupId, oldestMember.rows[0].user_id],
        );
      } else {
        await pool.query("DELETE FROM conversations WHERE id = $1", [groupId]);
      }
    }

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation:${groupId}`).emit("group-updated", { id: groupId });
    }

    res.json({ left: true });
  } catch (error) {
    console.error("Error leaving group:", error.message);
    res.status(500).json({
      error: "Internal server error",
      message: "Unable to leave group",
    });
  }
});

export default router;

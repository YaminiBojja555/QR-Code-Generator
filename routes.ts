import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { insertPostSchema, insertCommentSchema, insertLikeSchema, insertFollowSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  // Set up authentication routes
  setupAuth(app);

  // User routes
  app.get("/api/users/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) return res.status(400).send("Invalid user ID");
    
    const user = await storage.getUserWithStats(userId, req.user?.id);
    if (!user) return res.status(404).send("User not found");
    
    // Don't return password
    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  });
  
  app.get("/api/users/:id/posts", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) return res.status(400).send("Invalid user ID");
    
    const posts = await storage.getPostsByUser(userId);
    res.json(posts);
  });
  
  app.patch("/api/users/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) return res.status(400).send("Invalid user ID");
    
    // Can only update your own profile
    if (req.user?.id !== userId) return res.status(403).send("Unauthorized");
    
    // Only allow updating certain fields
    const { displayName, bio, avatarUrl } = req.body;
    const updateData = { displayName, bio, avatarUrl };
    
    const updatedUser = await storage.updateUser(userId, updateData);
    if (!updatedUser) return res.status(404).send("User not found");
    
    // Don't return password
    const { password, ...userWithoutPassword } = updatedUser;
    res.json(userWithoutPassword);
  });
  
  app.get("/api/users/search", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const query = req.query.q as string || "";
    const users = await storage.searchUsers(query);
    
    // Don't return passwords
    const usersWithoutPasswords = users.map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });
    
    res.json(usersWithoutPasswords);
  });
  
  // Post routes
  app.get("/api/posts", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const posts = await storage.getDiscoverFeed();
    res.json(posts);
  });
  
  app.get("/api/feed", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const posts = await storage.getFeedForUser(req.user.id);
    res.json(posts);
  });
  
  app.get("/api/posts/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const postId = parseInt(req.params.id);
    if (isNaN(postId)) return res.status(400).send("Invalid post ID");
    
    const post = await storage.getPost(postId);
    if (!post) return res.status(404).send("Post not found");
    
    res.json(post);
  });
  
  app.post("/api/posts", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const validatedData = insertPostSchema.parse({
        ...req.body,
        userId: req.user.id
      });
      
      const post = await storage.createPost(validatedData);
      const enrichedPost = await storage.getPost(post.id);
      
      res.status(201).json(enrichedPost);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      throw error;
    }
  });
  
  app.patch("/api/posts/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const postId = parseInt(req.params.id);
    if (isNaN(postId)) return res.status(400).send("Invalid post ID");
    
    const post = await storage.getPost(postId);
    if (!post) return res.status(404).send("Post not found");
    
    // Check if user is the owner of the post
    if (post.userId !== req.user.id) {
      return res.status(403).send("Unauthorized");
    }
    
    try {
      // Only allow updating content and imageUrl
      const { content, imageUrl } = req.body;
      const updateData = { content, imageUrl };
      
      const updatedPost = await storage.updatePost(postId, updateData);
      const enrichedPost = await storage.getPost(updatedPost!.id);
      
      res.json(enrichedPost);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      throw error;
    }
  });
  
  app.delete("/api/posts/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const postId = parseInt(req.params.id);
    if (isNaN(postId)) return res.status(400).send("Invalid post ID");
    
    const post = await storage.getPost(postId);
    if (!post) return res.status(404).send("Post not found");
    
    // Check if user is the owner of the post
    if (post.userId !== req.user.id) {
      return res.status(403).send("Unauthorized");
    }
    
    await storage.deletePost(postId);
    res.status(204).send();
  });
  
  // Comment routes
  app.get("/api/posts/:id/comments", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const postId = parseInt(req.params.id);
    if (isNaN(postId)) return res.status(400).send("Invalid post ID");
    
    const comments = await storage.getCommentsByPost(postId);
    res.json(comments);
  });
  
  app.post("/api/posts/:id/comments", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const postId = parseInt(req.params.id);
    if (isNaN(postId)) return res.status(400).send("Invalid post ID");
    
    try {
      const validatedData = insertCommentSchema.parse({
        ...req.body,
        postId,
        userId: req.user.id
      });
      
      const comment = await storage.createComment(validatedData);
      // Get comment with user data
      const comments = await storage.getCommentsByPost(postId);
      const commentWithUser = comments.find(c => c.id === comment.id);
      
      res.status(201).json(commentWithUser);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      throw error;
    }
  });
  
  app.delete("/api/comments/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const commentId = parseInt(req.params.id);
    if (isNaN(commentId)) return res.status(400).send("Invalid comment ID");
    
    const comment = Array.from(storage["comments"].values())
      .find(c => c.id === commentId);
    
    if (!comment) return res.status(404).send("Comment not found");
    
    // Check if user is the owner of the comment
    if (comment.userId !== req.user.id) {
      return res.status(403).send("Unauthorized");
    }
    
    await storage.deleteComment(commentId);
    res.status(204).send();
  });
  
  // Like routes
  app.post("/api/posts/:id/likes", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const postId = parseInt(req.params.id);
    if (isNaN(postId)) return res.status(400).send("Invalid post ID");
    
    // Check if user already liked the post
    const existingLike = await storage.getLike(postId, req.user.id);
    if (existingLike) {
      return res.status(409).send("Post already liked");
    }
    
    try {
      const validatedData = insertLikeSchema.parse({
        postId,
        userId: req.user.id
      });
      
      const like = await storage.createLike(validatedData);
      res.status(201).json(like);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      throw error;
    }
  });
  
  app.delete("/api/posts/:id/likes", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const postId = parseInt(req.params.id);
    if (isNaN(postId)) return res.status(400).send("Invalid post ID");
    
    await storage.deleteLike(postId, req.user.id);
    res.status(204).send();
  });
  
  // Follow routes
  app.post("/api/users/:id/follow", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const followingId = parseInt(req.params.id);
    if (isNaN(followingId)) return res.status(400).send("Invalid user ID");
    
    // Can't follow yourself
    if (followingId === req.user.id) {
      return res.status(400).send("Cannot follow yourself");
    }
    
    // Check if already following
    const existingFollow = await storage.getFollow(req.user.id, followingId);
    if (existingFollow) {
      return res.status(409).send("Already following");
    }
    
    try {
      const validatedData = insertFollowSchema.parse({
        followerId: req.user.id,
        followingId
      });
      
      const follow = await storage.createFollow(validatedData);
      res.status(201).json(follow);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      throw error;
    }
  });
  
  app.delete("/api/users/:id/follow", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const followingId = parseInt(req.params.id);
    if (isNaN(followingId)) return res.status(400).send("Invalid user ID");
    
    await storage.deleteFollow(req.user.id, followingId);
    res.status(204).send();
  });
  
  const httpServer = createServer(app);
  return httpServer;
}

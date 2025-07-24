import { users, type User, type InsertUser, posts, type Post, type InsertPost, comments, type Comment, type InsertComment, likes, type Like, type InsertLike, follows, type Follow, type InsertFollow, type PostWithUser, type CommentWithUser, type UserWithStats } from "@shared/schema";
import session from "express-session";
import { db } from "./db";
import { eq, and, or, like, desc, asc, not, isNull, sql, inArray } from "drizzle-orm";
import connectPg from "connect-pg-simple";
import postgres from "postgres";
import createMemoryStore from "memorystore";

const MemoryStore = createMemoryStore(session);
const PostgresSessionStore = connectPg(session);
const sessionPool = postgres(process.env.DATABASE_URL!);

export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined>;
  
  // Post operations
  getPosts(): Promise<PostWithUser[]>;
  getPostsByUser(userId: number): Promise<PostWithUser[]>;
  getPost(id: number): Promise<PostWithUser | undefined>;
  createPost(post: InsertPost): Promise<Post>;
  updatePost(id: number, post: Partial<InsertPost>): Promise<Post | undefined>;
  deletePost(id: number): Promise<boolean>;
  
  // Comment operations
  getCommentsByPost(postId: number): Promise<CommentWithUser[]>;
  createComment(comment: InsertComment): Promise<Comment>;
  deleteComment(id: number): Promise<boolean>;
  
  // Like operations
  getLikesByPost(postId: number): Promise<Like[]>;
  getLike(postId: number, userId: number): Promise<Like | undefined>;
  createLike(like: InsertLike): Promise<Like>;
  deleteLike(postId: number, userId: number): Promise<boolean>;
  
  // Follow operations
  getFollowers(userId: number): Promise<User[]>;
  getFollowing(userId: number): Promise<User[]>;
  getFollow(followerId: number, followingId: number): Promise<Follow | undefined>;
  createFollow(follow: InsertFollow): Promise<Follow>;
  deleteFollow(followerId: number, followingId: number): Promise<boolean>;
  
  // Feed operations
  getFeedForUser(userId: number): Promise<PostWithUser[]>;
  getDiscoverFeed(): Promise<PostWithUser[]>;
  
  // Search operation
  searchUsers(query: string): Promise<User[]>;
  
  // Session store
  sessionStore: any;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private posts: Map<number, Post>;
  private comments: Map<number, Comment>;
  private likes: Map<number, Like>;
  private follows: Map<number, Follow>;
  
  currentUserId: number;
  currentPostId: number;
  currentCommentId: number;
  currentLikeId: number;
  currentFollowId: number;
  sessionStore: any;

  constructor() {
    this.users = new Map();
    this.posts = new Map();
    this.comments = new Map();
    this.likes = new Map();
    this.follows = new Map();
    
    this.currentUserId = 1;
    this.currentPostId = 1;
    this.currentCommentId = 1;
    this.currentLikeId = 1;
    this.currentFollowId = 1;
    
    this.sessionStore = new MemoryStore({
      checkPeriod: 86400000,
    });
    
    // Add some default avatar URLs
    this.defaultAvatars = [
      "https://randomuser.me/api/portraits/women/44.jpg",
      "https://randomuser.me/api/portraits/men/75.jpg",
      "https://randomuser.me/api/portraits/women/68.jpg",
      "https://randomuser.me/api/portraits/men/10.jpg",
      "https://randomuser.me/api/portraits/women/26.jpg",
      "https://randomuser.me/api/portraits/men/32.jpg"
    ];
    
    // Add some default post images
    this.defaultPostImages = [
      "https://images.unsplash.com/photo-1501854140801-50d01698950b?w=500&auto=format&fit=crop",
      "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=500&auto=format&fit=crop",
      "https://images.unsplash.com/photo-1561948955-570b270e7c36?w=500&auto=format&fit=crop",
      "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=500&auto=format&fit=crop",
      "https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=500&auto=format&fit=crop",
      "https://images.unsplash.com/photo-1514565131-fce0801e5785?w=500&auto=format&fit=crop",
      "https://images.unsplash.com/photo-1455849318743-b2233052fcff?w=500&auto=format&fit=crop",
      "https://images.unsplash.com/photo-1496449903678-68ddcb189a24?w=500&auto=format&fit=crop"
    ];
  }
  
  private defaultAvatars: string[];
  private defaultPostImages: string[];
  
  getRandomAvatar(): string {
    return this.defaultAvatars[Math.floor(Math.random() * this.defaultAvatars.length)];
  }
  
  getRandomPostImage(): string {
    return this.defaultPostImages[Math.floor(Math.random() * this.defaultPostImages.length)];
  }

  // User operations
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username.toLowerCase() === username.toLowerCase(),
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const now = new Date();
    const avatarUrl = insertUser.avatarUrl || this.getRandomAvatar();
    const bio = insertUser.bio || null;
    
    const user: User = { 
      ...insertUser, 
      id, 
      avatarUrl,
      bio,
      createdAt: now
    };
    
    this.users.set(id, user);
    return user;
  }
  
  async updateUser(id: number, userData: Partial<InsertUser>): Promise<User | undefined> {
    const user = await this.getUser(id);
    if (!user) return undefined;
    
    const updatedUser = { ...user, ...userData };
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  // Post operations
  async getPosts(): Promise<PostWithUser[]> {
    const postsArray = Array.from(this.posts.values());
    return this.enrichPosts(postsArray);
  }
  
  async getPostsByUser(userId: number): Promise<PostWithUser[]> {
    const postsArray = Array.from(this.posts.values())
      .filter(post => post.userId === userId);
    return this.enrichPosts(postsArray);
  }
  
  async getPost(id: number): Promise<PostWithUser | undefined> {
    const post = this.posts.get(id);
    if (!post) return undefined;
    
    const enriched = await this.enrichPosts([post]);
    return enriched[0];
  }
  
  async createPost(insertPost: InsertPost): Promise<Post> {
    const id = this.currentPostId++;
    const now = new Date();
    
    const post: Post = { 
      ...insertPost, 
      id, 
      createdAt: now
    };
    
    this.posts.set(id, post);
    return post;
  }
  
  async updatePost(id: number, postData: Partial<InsertPost>): Promise<Post | undefined> {
    const post = this.posts.get(id);
    if (!post) return undefined;
    
    const updatedPost = { ...post, ...postData };
    this.posts.set(id, updatedPost);
    return updatedPost;
  }
  
  async deletePost(id: number): Promise<boolean> {
    // Delete associated comments and likes first
    const postComments = Array.from(this.comments.values())
      .filter(comment => comment.postId === id);
    
    for (const comment of postComments) {
      this.comments.delete(comment.id);
    }
    
    const postLikes = Array.from(this.likes.values())
      .filter(like => like.postId === id);
    
    for (const like of postLikes) {
      this.likes.delete(like.id);
    }
    
    return this.posts.delete(id);
  }
  
  // Comment operations
  async getCommentsByPost(postId: number): Promise<CommentWithUser[]> {
    const commentsArray = Array.from(this.comments.values())
      .filter(comment => comment.postId === postId);
    
    return await Promise.all(commentsArray.map(async (comment) => {
      const user = await this.getUser(comment.userId);
      return {
        ...comment,
        user: user!
      };
    }));
  }
  
  async createComment(insertComment: InsertComment): Promise<Comment> {
    const id = this.currentCommentId++;
    const now = new Date();
    
    const comment: Comment = { 
      ...insertComment, 
      id, 
      createdAt: now
    };
    
    this.comments.set(id, comment);
    return comment;
  }
  
  async deleteComment(id: number): Promise<boolean> {
    return this.comments.delete(id);
  }
  
  // Like operations
  async getLikesByPost(postId: number): Promise<Like[]> {
    return Array.from(this.likes.values())
      .filter(like => like.postId === postId);
  }
  
  async getLike(postId: number, userId: number): Promise<Like | undefined> {
    return Array.from(this.likes.values())
      .find(like => like.postId === postId && like.userId === userId);
  }
  
  async createLike(insertLike: InsertLike): Promise<Like> {
    const id = this.currentLikeId++;
    const now = new Date();
    
    const like: Like = { 
      ...insertLike, 
      id, 
      createdAt: now
    };
    
    this.likes.set(id, like);
    return like;
  }
  
  async deleteLike(postId: number, userId: number): Promise<boolean> {
    const like = await this.getLike(postId, userId);
    if (!like) return false;
    
    return this.likes.delete(like.id);
  }
  
  // Follow operations
  async getFollowers(userId: number): Promise<User[]> {
    const followerRelations = Array.from(this.follows.values())
      .filter(follow => follow.followingId === userId);
    
    const followers = await Promise.all(
      followerRelations.map(async (relation) => {
        const user = await this.getUser(relation.followerId);
        return user!;
      })
    );
    
    return followers;
  }
  
  async getFollowing(userId: number): Promise<User[]> {
    const followingRelations = Array.from(this.follows.values())
      .filter(follow => follow.followerId === userId);
    
    const following = await Promise.all(
      followingRelations.map(async (relation) => {
        const user = await this.getUser(relation.followingId);
        return user!;
      })
    );
    
    return following;
  }
  
  async getFollow(followerId: number, followingId: number): Promise<Follow | undefined> {
    return Array.from(this.follows.values())
      .find(follow => follow.followerId === followerId && follow.followingId === followingId);
  }
  
  async createFollow(insertFollow: InsertFollow): Promise<Follow> {
    const id = this.currentFollowId++;
    const now = new Date();
    
    const follow: Follow = { 
      ...insertFollow, 
      id, 
      createdAt: now
    };
    
    this.follows.set(id, follow);
    return follow;
  }
  
  async deleteFollow(followerId: number, followingId: number): Promise<boolean> {
    const follow = await this.getFollow(followerId, followingId);
    if (!follow) return false;
    
    return this.follows.delete(follow.id);
  }
  
  // Feed operations
  async getFeedForUser(userId: number): Promise<PostWithUser[]> {
    // Get users that this user follows
    const following = await this.getFollowing(userId);
    const followingIds = following.map(user => user.id);
    
    // Get posts from followed users and the user's own posts
    const feedPosts = Array.from(this.posts.values())
      .filter(post => followingIds.includes(post.userId) || post.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    
    return this.enrichPosts(feedPosts, userId);
  }
  
  async getDiscoverFeed(): Promise<PostWithUser[]> {
    // Return all posts sorted by newest first
    const allPosts = Array.from(this.posts.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    
    return this.enrichPosts(allPosts);
  }
  
  // Search operation
  async searchUsers(query: string): Promise<User[]> {
    if (!query) return [];
    
    const lowercaseQuery = query.toLowerCase();
    return Array.from(this.users.values())
      .filter(user => 
        user.username.toLowerCase().includes(lowercaseQuery) || 
        user.displayName.toLowerCase().includes(lowercaseQuery)
      );
  }
  
  // Helper function to enrich posts with user data and counts
  private async enrichPosts(posts: Post[], currentUserId?: number): Promise<PostWithUser[]> {
    return await Promise.all(posts.map(async (post) => {
      const user = await this.getUser(post.userId);
      const likes = await this.getLikesByPost(post.id);
      const comments = await this.getCommentsByPost(post.id);
      
      let isLiked = undefined;
      if (currentUserId) {
        const userLike = await this.getLike(post.id, currentUserId);
        isLiked = !!userLike;
      }
      
      return {
        ...post,
        user: user!,
        likeCount: likes.length,
        commentCount: comments.length,
        isLiked
      };
    }));
  }
  
  // Helper to get user with stats
  async getUserWithStats(userId: number, currentUserId?: number): Promise<UserWithStats | undefined> {
    const user = await this.getUser(userId);
    if (!user) return undefined;
    
    const followers = await this.getFollowers(userId);
    const following = await this.getFollowing(userId);
    
    let isFollowing = undefined;
    if (currentUserId) {
      const followRelation = await this.getFollow(currentUserId, userId);
      isFollowing = !!followRelation;
    }
    
    return {
      ...user,
      followersCount: followers.length,
      followingCount: following.length,
      isFollowing
    };
  }
}

export class DatabaseStorage implements IStorage {
  sessionStore: any;

  constructor() {
    this.sessionStore = new PostgresSessionStore({
      pool: sessionPool,
      createTableIfMissing: true
    });
  }

  // User operations
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const avatarUrl = insertUser.avatarUrl || this.getRandomAvatar();
    const now = new Date();
    
    const [user] = await db
      .insert(users)
      .values({ ...insertUser, avatarUrl, createdAt: now })
      .returning();
    
    return user;
  }

  async updateUser(id: number, userData: Partial<InsertUser>): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set(userData)
      .where(eq(users.id, id))
      .returning();
    
    return updatedUser;
  }

  // Post operations
  async getPosts(): Promise<PostWithUser[]> {
    const postsData = await db
      .select()
      .from(posts)
      .orderBy(desc(posts.createdAt));
    
    return this.enrichPosts(postsData);
  }

  async getPostsByUser(userId: number): Promise<PostWithUser[]> {
    const postsData = await db
      .select()
      .from(posts)
      .where(eq(posts.userId, userId))
      .orderBy(desc(posts.createdAt));
    
    return this.enrichPosts(postsData);
  }

  async getPost(id: number): Promise<PostWithUser | undefined> {
    const [post] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, id));
    
    if (!post) return undefined;
    
    const enriched = await this.enrichPosts([post]);
    return enriched[0];
  }

  async createPost(insertPost: InsertPost): Promise<Post> {
    const now = new Date();
    
    const [post] = await db
      .insert(posts)
      .values({ ...insertPost, createdAt: now })
      .returning();
    
    return post;
  }

  async updatePost(id: number, postData: Partial<InsertPost>): Promise<Post | undefined> {
    const [updatedPost] = await db
      .update(posts)
      .set(postData)
      .where(eq(posts.id, id))
      .returning();
    
    return updatedPost;
  }

  async deletePost(id: number): Promise<boolean> {
    // Delete associated comments first
    await db
      .delete(comments)
      .where(eq(comments.postId, id));
    
    // Delete associated likes
    await db
      .delete(likes)
      .where(eq(likes.postId, id));
    
    // Delete the post
    const result = await db
      .delete(posts)
      .where(eq(posts.id, id));
    
    return result.count > 0;
  }

  // Comment operations
  async getCommentsByPost(postId: number): Promise<CommentWithUser[]> {
    const commentsData = await db
      .select()
      .from(comments)
      .where(eq(comments.postId, postId))
      .orderBy(asc(comments.createdAt));
    
    return await Promise.all(commentsData.map(async (comment) => {
      const user = await this.getUser(comment.userId);
      return {
        ...comment,
        user: user!
      };
    }));
  }

  async createComment(insertComment: InsertComment): Promise<Comment> {
    const now = new Date();
    
    const [comment] = await db
      .insert(comments)
      .values({ ...insertComment, createdAt: now })
      .returning();
    
    return comment;
  }

  async deleteComment(id: number): Promise<boolean> {
    const result = await db
      .delete(comments)
      .where(eq(comments.id, id));
    
    return result.count > 0;
  }

  // Like operations
  async getLikesByPost(postId: number): Promise<Like[]> {
    return db
      .select()
      .from(likes)
      .where(eq(likes.postId, postId));
  }

  async getLike(postId: number, userId: number): Promise<Like | undefined> {
    const [like] = await db
      .select()
      .from(likes)
      .where(and(
        eq(likes.postId, postId),
        eq(likes.userId, userId)
      ));
    
    return like;
  }

  async createLike(insertLike: InsertLike): Promise<Like> {
    const now = new Date();
    
    const [like] = await db
      .insert(likes)
      .values({ ...insertLike, createdAt: now })
      .returning();
    
    return like;
  }

  async deleteLike(postId: number, userId: number): Promise<boolean> {
    const result = await db
      .delete(likes)
      .where(and(
        eq(likes.postId, postId),
        eq(likes.userId, userId)
      ));
    
    return result.count > 0;
  }

  // Follow operations
  async getFollowers(userId: number): Promise<User[]> {
    const followersData = await db
      .select({
        follower: users
      })
      .from(follows)
      .innerJoin(users, eq(follows.followerId, users.id))
      .where(eq(follows.followingId, userId));
    
    return followersData.map(item => item.follower);
  }

  async getFollowing(userId: number): Promise<User[]> {
    const followingData = await db
      .select({
        following: users
      })
      .from(follows)
      .innerJoin(users, eq(follows.followingId, users.id))
      .where(eq(follows.followerId, userId));
    
    return followingData.map(item => item.following);
  }

  async getFollow(followerId: number, followingId: number): Promise<Follow | undefined> {
    const [follow] = await db
      .select()
      .from(follows)
      .where(and(
        eq(follows.followerId, followerId),
        eq(follows.followingId, followingId)
      ));
    
    return follow;
  }

  async createFollow(insertFollow: InsertFollow): Promise<Follow> {
    const now = new Date();
    
    const [follow] = await db
      .insert(follows)
      .values({ ...insertFollow, createdAt: now })
      .returning();
    
    return follow;
  }

  async deleteFollow(followerId: number, followingId: number): Promise<boolean> {
    const result = await db
      .delete(follows)
      .where(and(
        eq(follows.followerId, followerId),
        eq(follows.followingId, followingId)
      ));
    
    return result.count > 0;
  }

  // Feed operations
  async getFeedForUser(userId: number): Promise<PostWithUser[]> {
    // Get users that this user follows
    const following = await this.getFollowing(userId);
    const followingIds = following.map(user => user.id);
    
    // Get posts from followed users and the user's own posts
    const feedPosts = await db
      .select()
      .from(posts)
      .where(or(
        eq(posts.userId, userId),
        inArray(posts.userId, followingIds)
      ))
      .orderBy(desc(posts.createdAt));
    
    return this.enrichPosts(feedPosts, userId);
  }

  async getDiscoverFeed(): Promise<PostWithUser[]> {
    // Return all posts sorted by newest first
    const allPosts = await db
      .select()
      .from(posts)
      .orderBy(desc(posts.createdAt));
    
    return this.enrichPosts(allPosts);
  }

  // Search operation
  async searchUsers(query: string): Promise<User[]> {
    if (!query) return [];
    
    return db
      .select()
      .from(users)
      .where(or(
        like(users.username, `%${query}%`),
        like(users.displayName, `%${query}%`)
      ));
  }

  // Helper function to enrich posts with user data and counts
  private async enrichPosts(posts: Post[], currentUserId?: number): Promise<PostWithUser[]> {
    return await Promise.all(posts.map(async (post) => {
      const user = await this.getUser(post.userId);
      const likes = await this.getLikesByPost(post.id);
      const commentsResult = await this.getCommentsByPost(post.id);
      
      let isLiked = undefined;
      if (currentUserId) {
        const userLike = await this.getLike(post.id, currentUserId);
        isLiked = !!userLike;
      }
      
      return {
        ...post,
        user: user!,
        likeCount: likes.length,
        commentCount: commentsResult.length,
        isLiked
      };
    }));
  }

  // Helper to get user with stats
  async getUserWithStats(userId: number, currentUserId?: number): Promise<UserWithStats | undefined> {
    const user = await this.getUser(userId);
    if (!user) return undefined;
    
    const followers = await this.getFollowers(userId);
    const following = await this.getFollowing(userId);
    
    let isFollowing = undefined;
    if (currentUserId) {
      const followRelation = await this.getFollow(currentUserId, userId);
      isFollowing = !!followRelation;
    }
    
    return {
      ...user,
      followersCount: followers.length,
      followingCount: following.length,
      isFollowing
    };
  }

  // Helper methods for random data
  private defaultAvatars = [
    "https://randomuser.me/api/portraits/women/44.jpg",
    "https://randomuser.me/api/portraits/men/75.jpg",
    "https://randomuser.me/api/portraits/women/68.jpg",
    "https://randomuser.me/api/portraits/men/10.jpg",
    "https://randomuser.me/api/portraits/women/26.jpg",
    "https://randomuser.me/api/portraits/men/32.jpg"
  ];

  private defaultPostImages = [
    "https://images.unsplash.com/photo-1501854140801-50d01698950b?w=500&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=500&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1561948955-570b270e7c36?w=500&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=500&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=500&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1514565131-fce0801e5785?w=500&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1455849318743-b2233052fcff?w=500&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1496449903678-68ddcb189a24?w=500&auto=format&fit=crop"
  ];

  getRandomAvatar(): string {
    return this.defaultAvatars[Math.floor(Math.random() * this.defaultAvatars.length)];
  }

  getRandomPostImage(): string {
    return this.defaultPostImages[Math.floor(Math.random() * this.defaultPostImages.length)];
  }
}

// Use the database storage instead of in-memory storage
export const storage = new DatabaseStorage();

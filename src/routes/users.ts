import { Router } from 'express';
import { getMe, updateMe, searchUsers } from '../controllers/authController';
import { authenticateToken } from '../middleware/authenticateToken';

const router = Router();

router.get('/me', authenticateToken, getMe);
router.patch('/me', authenticateToken, updateMe);
router.get('/search', authenticateToken, searchUsers);

export default router;

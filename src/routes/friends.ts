import { Router } from 'express';
import { sendFriendRequest, getFriends, getFriendRequests, respondToFriendRequest, unfriend } from '../controllers/friendsController';
import { authenticateToken } from '../middleware/authenticateToken';

const router = Router();

router.post('/request', authenticateToken, sendFriendRequest);
router.get('/', authenticateToken, getFriends);
router.get('/requests', authenticateToken, getFriendRequests);
router.patch('/request/:id', authenticateToken, respondToFriendRequest);
router.delete('/:id', authenticateToken, unfriend);

export default router;

import express from 'express';
import * as channelController from '../controllers/channelController.js';
import { check, param, validationResult } from 'express-validator';

const router = express.Router();

// Validation for ID parameter
const validateId = [
  param('id').isInt({ gt: 0 }).withMessage('ID must be a positive integer')
];

// Validation rules for channel data
const validateChannelPOST = [
  check('name').isString().isLength({ min: 3, max: 50 }).withMessage('Name must be a string between 3 and 50 characters'),
  check('type').isIn(['public', 'private']).withMessage('Type must be one of: public, private')
];

const validateChannelPUT = [
    check('name').optional().isString().isLength({ min: 3, max: 50 }).withMessage('Name must be a string between 3 and 50 characters'),
    check('type').optional().isIn(['public', 'private']).withMessage('Type must be one of: public, private')
];

// Middleware to check validation result
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Get all channels
router.get('/', channelController.getAllChannels);

// Get a single channel by ID
router.get('/:id', validateId, validate, channelController.getChannelById);

// Create a new channel
router.post('/', validateChannelPOST, validate, channelController.createChannel);

// Update an existing channel by ID
router.put('/:id', [...validateId, ...validateChannelPUT], validate, channelController.updateChannel);

// Delete a channel by ID
router.delete('/:id', validateId, validate, channelController.deleteChannel);

export default router;

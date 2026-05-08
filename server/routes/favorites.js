const express = require('express');
const router = express.Router();
const { favorites } = require('../db/sqlite');
const { sources } = require('../db');
const { requireAuth } = require('../auth');

// All favorites routes require authentication
router.use(requireAuth);

// Get all favorites for current user
router.get('/', async (req, res) => {
    try {
        const { sourceId, itemType, details } = req.query;

        if (details === 'channel' && itemType === 'channel') {
            const sourceList = await sources.getAll();
            const sourceMap = new Map(sourceList.map(source => [source.id, source]));
            const items = favorites.getDetailedChannels(req.user.id).map(row => {
                const source = sourceMap.get(row.source_id);
                const sourceType = source?.type || 'xtream';
                const data = JSON.parse(row.data || '{}');

                return {
                    id: row.id,
                    source_id: row.source_id,
                    item_id: row.item_id,
                    item_type: row.item_type,
                    sourceId: row.source_id,
                    sourceType,
                    channelId: `${sourceType}_${row.source_id}_${row.item_id}`,
                    streamId: row.item_id,
                    name: row.name,
                    tvgLogo: row.stream_icon,
                    url: row.stream_url,
                    tvgId: data.epg_channel_id || data.tvgId || null
                };
            });

            return res.json(items);
        }

        const items = favorites.getAll(req.user.id, sourceId || null, itemType || null);
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add favorite for current user
router.post('/', async (req, res) => {
    try {
        const { sourceId, itemId, itemType = 'channel' } = req.body;
        if (!sourceId || !itemId) {
            return res.status(400).json({ error: 'Source ID and Item ID are required' });
        }

        favorites.add(req.user.id, sourceId, itemId, itemType);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Remove favorite for current user
router.delete('/', async (req, res) => {
    try {
        const { sourceId, itemId, itemType = 'channel' } = req.body;
        if (!sourceId || !itemId) {
            return res.status(400).json({ error: 'Source ID and Item ID are required' });
        }

        favorites.remove(req.user.id, sourceId, itemId, itemType);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Check if item is favorited by current user
router.get('/check', async (req, res) => {
    try {
        const { sourceId, itemId, itemType = 'channel' } = req.query;
        if (!sourceId || !itemId) {
            return res.status(400).json({ error: 'Source ID and Item ID are required' });
        }

        const isFav = favorites.isFavorite(req.user.id, sourceId, itemId, itemType);
        res.json({ isFavorite: isFav });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

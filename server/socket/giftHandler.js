const supabase = require('../services/supabase');

const VALID_GIFTS = ['heart', 'rose', 'fire', 'trophy', 'laugh', 'star', 'clap'];
const GIFT_COSTS = {
  heart: 5, rose: 10, fire: 15, trophy: 20, laugh: 5, star: 10, clap: 5
};

function initGiftHandler(io, socket) {

  socket.on('send_gift', async ({ roomId, receiverUserId, giftType }) => {
    if (!VALID_GIFTS.includes(giftType)) {
      return socket.emit('error', { message: 'Invalid gift type' });
    }

    // Check sender has enough coins
    const { data: sender } = await supabase.from('users').select('coins').eq('id', socket.userId).single();
    const cost = GIFT_COSTS[giftType];
    if (!sender || sender.coins < cost) {
      return socket.emit('error', { message: 'Not enough coins' });
    }

    // Deduct coins from sender
    await supabase.from('users').update({ coins: sender.coins - cost }).eq('id', socket.userId);

    // Record the gift
    await supabase.from('gifts').insert({
      room_id: roomId,
      sender_id: socket.userId,
      receiver_id: receiverUserId,
      gift_type: giftType,
    });

    // Send gift animation to the RECEIVER only
    io.to(roomId).emit('gift_received', {
      senderUserId: socket.userId,
      senderUsername: socket.username,
      giftType,
      timestamp: Date.now(),
    });
  });
}

module.exports = { initGiftHandler };
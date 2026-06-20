// WebRTC Signaling Server
// This does NOT process audio — it just helps the two phones "find" each other
// Once connected, voice goes directly phone-to-phone (peer-to-peer)

function initWebRTCSignaling(io, socket) {

  // Phone A sends its connection "offer" to Phone B
  socket.on('webrtc_offer', ({ roomId, offer, targetUserId }) => {
    socket.to(roomId).emit('webrtc_offer', {
      offer,
      fromUserId: socket.userId,
    });
  });

  // Phone B responds with its "answer"
  socket.on('webrtc_answer', ({ roomId, answer }) => {
    socket.to(roomId).emit('webrtc_answer', {
      answer,
      fromUserId: socket.userId,
    });
  });

  // ICE candidates help phones punch through firewalls
  socket.on('webrtc_ice_candidate', ({ roomId, candidate }) => {
    socket.to(roomId).emit('webrtc_ice_candidate', {
      candidate,
      fromUserId: socket.userId,
    });
  });

  // Player mutes/unmutes
  socket.on('voice_state', ({ roomId, muted }) => {
    socket.to(roomId).emit('opponent_voice_state', {
      userId: socket.userId,
      muted,
    });
  });
}

module.exports = { initWebRTCSignaling };
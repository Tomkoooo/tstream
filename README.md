# tStream - Wireless Camera Streaming Platform

A real-time wireless camera streaming platform built with Next.js, Socket.io, and WebRTC. Stream camera feeds from any device wirelessly to a central admin dashboard with full control and OBS integration.

![TStream Demo](https://img.shields.io/badge/Status-Active-green) ![Next.js](https://img.shields.io/badge/Next.js-15.3.3-black) ![WebRTC](https://img.shields.io/badge/WebRTC-Enabled-blue) ![Socket.io](https://img.shields.io/badge/Socket.io-4.8.1-green)

## ✨ Features

### 🎥 **Multi-Camera Streaming**
- Stream from unlimited devices simultaneously
- Real-time video and audio transmission
- Automatic quality adaptation based on network conditions
- Support for mobile phones, tablets, laptops, and webcams

### 🎛️ **Admin Dashboard**
- Central control panel for all connected cameras
- Real-time stream statistics (FPS, bitrate, packet loss)
- Individual camera controls and settings
- Participant management with kick functionality

### 🎨 **Video Controls**
- **Transform Options**: Horizontal/vertical flip, 90° rotation
- **Audio Selection**: Choose which camera's audio to monitor
- **Fullscreen Mode**: Individual camera fullscreen viewing
- **Stream Settings**: Adjustable resolution, FPS, and bitrate

### 📺 **OBS Integration**
- **Individual Camera Views**: Separate URLs for each camera
- **Browser Source Compatible**: Direct integration with OBS Studio
- **Transform Support**: Flip and rotation settings preserved
- **Clean Interface**: Minimal UI for professional streaming

### 🔧 **Advanced Features**
- **WebRTC P2P**: Low-latency peer-to-peer connections
- **Automatic Reconnection**: Handles network interruptions gracefully
- **STUN/TURN Support**: Works behind NAT and firewalls
- **Responsive Design**: Works on desktop and mobile devices

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Modern web browser with WebRTC support

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/tomkoooo/tstream.git
   cd tstream
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm run dev
   ```

4. **Open your browser**
   - Navigate to `http://localhost:8080`
   - Create a room as admin
   - Share the join link with camera devices

## 📖 Usage Guide

### 🏠 **Creating a Room**

1. Go to the main page
2. Click "Create Room"
3. Set room name and password
4. Share the generated link with participants

### 📱 **Joining as a Camera**

1. Open the shared link on your device
2. Enter the room password
3. Allow camera and microphone access
4. Configure stream settings (resolution, FPS, bitrate)
5. Click "Start Streaming"

### 👨‍💼 **Admin Controls**

**Main Dashboard:**
- View all connected cameras in a grid layout
- Monitor real-time statistics for each stream
- Select which camera's audio to listen to
- Control individual camera settings

**Per-Camera Actions:**
- **Fullscreen**: Open camera in fullscreen mode
- **OBS View**: Generate individual URL for OBS Studio
- **Transform**: Flip horizontally/vertically, rotate 90°
- **Audio Select**: Choose as primary audio source
- **Reconnect**: Restart connection if issues occur
- **Kick**: Remove participant from room

### 🎬 **OBS Studio Integration**

1. In admin dashboard, click **⋮** → **"Individual View (OBS)"**
2. Copy the generated URL
3. In OBS Studio:
   - Add **Browser Source**
   - Paste the URL
   - Set resolution (e.g., 1920x1080)
   - The camera feed will appear with applied transforms

## ⚙️ Configuration

### Environment Variables

Create a `.env.local` file in the root directory:

```env
# Base URL for the application
NEXT_PUBLIC_BASE_URL=http://localhost:8080

# WebRTC Configuration
NEXT_PUBLIC_STUN_SERVERS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302

# Optional: Custom TURN servers for better NAT traversal
NEXT_PUBLIC_TURN_SERVER_URL=turn:your-turn-server.com:3478
NEXT_PUBLIC_TURN_USERNAME=username
NEXT_PUBLIC_TURN_CREDENTIAL=password
```

### Stream Quality Settings

**Recommended Settings by Use Case:**

| Use Case | Resolution | FPS | Bitrate |
|----------|------------|-----|---------|
| Mobile/Preview | 480p | 15 | 500 kbps |
| Standard Quality | 720p | 30 | 2000 kbps |
| High Quality | 1080p | 30 | 4000 kbps |
| Ultra Quality | 1080p | 60 | 6000 kbps |

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client Device │    │   Next.js App   │    │  Admin Dashboard│
│   (Camera)      │◄──►│  + Socket.io    │◄──►│   (Control)     │
│                 │    │   Server        │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                    WebRTC P2P Connection
```

### Tech Stack
- **Frontend**: Next.js 15.3.3, React 19, TypeScript
- **Styling**: Tailwind CSS 4, DaisyUI 5
- **Real-time**: Socket.io 4.8.1
- **WebRTC**: Native browser APIs
- **Backend**: Node.js with Socket.io server

## 🛠️ Development

### Project Structure
```
tstream/
├── src/
│   ├── app/
│   │   ├── admin/[roomId]/     # Admin dashboard
│   │   ├── join/[roomId]/      # Client streaming page
│   │   ├── camera/[participantId]/ # Individual camera view
│   │   └── api/socket/         # Socket.io API endpoint
│   └── components/             # Reusable React components
├── server.js                   # Socket.io server
├── public/                     # Static assets
└── package.json
```

### Available Scripts

```bash
# Development server
npm run dev

# Production build
npm run build

# Start production server
npm start

# Lint code
npm run lint
```

### WebRTC Flow

1. **Room Creation**: Admin creates room with Socket.io
2. **Client Join**: Camera devices join room with password
3. **Stream Start**: Client starts camera stream
4. **Admin Connection**: Admin initiates WebRTC offer to streaming client
5. **P2P Established**: Direct video/audio transmission begins
6. **Statistics**: Real-time monitoring of connection quality

## 🔧 Troubleshooting

### Common Issues

**No Video Stream:**
- Check camera permissions in browser
- Verify network connectivity
- Try reconnecting from admin panel

**Connection Failed:**
- Ensure STUN/TURN servers are accessible
- Check firewall settings
- Verify room password is correct

**Poor Quality:**
- Reduce resolution/bitrate in stream settings
- Check network bandwidth
- Try different STUN/TURN servers

**Audio Issues:**
- Verify microphone permissions
- Check audio source selection in admin panel
- Ensure browser supports audio streaming

### Debug Mode

Enable debug logging by opening browser console. The app provides detailed logs for:
- Socket.io connections
- WebRTC signaling
- Stream statistics
- Error conditions

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Use TypeScript for type safety
- Follow existing code style
- Add proper error handling
- Include debug logging for new features
- Test on multiple devices/browsers

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **WebRTC** for real-time communication
- **Socket.io** for reliable signaling
- **Next.js** for the application framework
- **DaisyUI** for beautiful UI components
- **Tailwind CSS** for styling utilities

## 📞 Support

- 🐛 **Bug Reports**: [Open an issue](https://github.com/tomkoooo/tstream/issues)
- 💡 **Feature Requests**: [Start a discussion](https://github.com/tomkoooo/tstream/discussions)
- 📧 **Contact**: toth.tamas@sironic.hu

---

**Made with ❤️ for seamless wireless streaming**
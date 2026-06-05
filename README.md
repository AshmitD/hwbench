# CoupledAI - Semantic Robot Visualization

A general-purpose 3D visualization and inspection tool for robots that bridges CAD models and control code using LLM-assisted semantic analysis.

**CPSC 4900 Senior Project** | Student: Aarush Sharma | Advisor: Prof. Timos Antonopoulos

---

## 🎯 Project Overview

CoupledAI automatically bridges the gap between mechanical robot design (CAD) and software control code. It provides an interactive 3D visualization environment where developers can upload robot models, analyze their structure, and eventually map control code to physical components using LLM-assisted semantic analysis.

### Current Status: Phase 1 Complete ✓

- ✅ Full project architecture setup (monorepo with frontend + backend)
- ✅ Dark-themed UI with silver accents
- ✅ 3D model upload and visualization (STL, OBJ, URDF, DAE)
- ✅ Automatic geometry analysis and information extraction
- ✅ Dynamic grid scaling based on model size
- ✅ Multi-panel resizable layout

---

## 🏗️ Architecture

### Project Structure

```
CoupledAI/
├── frontend/                      # React + Three.js UI
│   ├── src/
│   │   ├── components/
│   │   │   ├── Layout/           # Multi-panel layout system
│   │   │   ├── Viewport/         # 3D visualization
│   │   │   │   ├── Viewport3D.tsx       # Main 3D canvas
│   │   │   │   └── ModelViewer.tsx      # STL/OBJ loader & analyzer
│   │   │   └── Panels/           # Side panels (structure, code, controls)
│   │   ├── store/
│   │   │   └── appStore.ts       # Zustand global state
│   │   └── styles/
│   │       └── globals.css       # Design system & theme
│   └── package.json
│
├── backend/                       # Node.js + Express API
│   ├── src/
│   │   ├── routes/
│   │   │   ├── upload.ts         # File upload handling
│   │   │   ├── urdf.ts           # URDF parsing (Phase 2)
│   │   │   └── analysis.ts       # LLM code analysis (Phase 4)
│   │   ├── services/
│   │   │   └── urdfParser.ts     # URDF XML parser
│   │   └── index.ts              # Express server
│   └── package.json
│
└── uploads/                       # Uploaded model files
```

### Tech Stack

**Frontend:**
- React 18 + TypeScript
- Three.js + React Three Fiber (3D rendering)
- @react-three/drei (3D helpers: Grid, Controls, Gizmo)
- Zustand (state management)
- Vite (build tool)
- Axios (HTTP client)
- Lucide React (icons)

**Backend:**
- Node.js + Express + TypeScript
- Multer (file uploads)
- xml2js (URDF parsing)
- OpenAI API (for future LLM integration)

---

## 🎨 User Interface

### Design System

**Colors:**
- Background: `#1a1a1a` (primary), `#242424` (secondary)
- Accents: Silver/Chrome (`#c0c0c0`, `#e8e8e8`)
- Text: White with hierarchy (`#ffffff`, `#e0e0e0`, `#b0b0b0`)
- Borders: `#404040`, `#505050`

**Typography:**
- UI Font: Inter (clean, modern sans-serif)
- Code Font: JetBrains Mono (monospace for technical data)

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  🎚️ Toolbar                                             │
├─────────────┬─────────────────────────────┬─────────────┤
│             │                             │             │
│  📦 Robot   │    🎨 3D Viewport           │  📄 Code    │
│  Structure  │    (Three.js Canvas)        │  View       │
│             │                             │             │
│  (Left)     │    (Center - largest)       │  (Right)    │
│             │                             │             │
├─────────────┴─────────────────────────────┴─────────────┤
│  🎚️ Joint Controls                                      │
│  (Bottom - collapsible)                                 │
└─────────────────────────────────────────────────────────┘
```

All panels are **resizable** by dragging their edges.

---

## 🚀 How It Works

### 1. File Upload Flow

```
User clicks "Upload Model" 
    ↓
Select STL/OBJ/URDF/DAE file
    ↓
Frontend: FormData → POST /api/upload/model
    ↓
Backend: Multer saves to uploads/ folder
    ↓
Backend: Returns { filename, originalName, size, path }
    ↓
Frontend: Sets modelUrl = /api/files/{filename}
```

### 2. 3D Rendering & Analysis

```
ModelViewer component receives modelUrl
    ↓
STLLoader/OBJLoader fetches and parses file
    ↓
Geometry processing:
  - Compute vertex normals (for smooth shading)
  - Center model at origin (0,0,0)
  - Compute bounding box
    ↓
Extract geometry data:
  - Vertex count
  - Face/triangle count
  - Bounding box (min, max, size)
  - Volume (signed volume calculation)
    ↓
Store in Zustand global state (appStore)
    ↓
Auto-position camera (distance = maxDimension × 5)
Scale grid (size = maxDimension × 3)
    ↓
SidePanel reads from appStore and displays data
```

### 3. State Management (Zustand)

**appStore.ts** holds the global state:

```typescript
interface ModelInfo {
  filename: string;
  fileSize: number;
  vertexCount: number;
  faceCount: number;
  boundingBox: {
    min: { x, y, z };
    max: { x, y, z };
    size: { x, y, z };
  };
  volume?: number;
}
```

**Data flow:**
```
ModelViewer (extracts) → appStore.setModelInfo() → SidePanel (displays)
```

### 4. Dynamic Grid Scaling

The floor grid automatically scales based on model size:

```javascript
gridSize = max(modelMaxDimension × 3, 20)
cellSize = max(modelMaxDimension / 10, 1)
```

For a 330mm tube:
- Grid size: ~1000mm
- Cell size: ~33mm
- Visible reference plane for scale

### 5. Camera Auto-Positioning

Camera distance calculated to fit entire model:

```javascript
distance = modelMaxDimension × 5
cameraPosition = (distance, distance × 0.8, distance)
maxZoomOut = distance × 3
```

Ensures the model is fully visible on load.

---

## 📊 Extracted Information

When you upload an STL/OBJ file, the system automatically extracts:

### File Information
- Original filename
- File size (KB)

### Geometry Data
- **Vertices**: Total vertex count
- **Faces**: Total triangle count
- **Volume**: Calculated in mm³ using signed volume method

### Bounding Box
- **Dimensions**: X × Y × Z in mm
- **Min Coordinates**: (x, y, z) minimum corner
- **Max Coordinates**: (x, y, z) maximum corner

### Raw JSON
Complete data dump for debugging/inspection

**Example Output:**
```json
{
  "filename": "tube.stl",
  "fileSize": 43520,
  "vertexCount": 2880,
  "faceCount": 960,
  "boundingBox": {
    "min": { "x": -15.5, "y": -15.5, "z": -165.0 },
    "max": { "x": 15.5, "y": 15.5, "z": 165.0 },
    "size": { "x": 31.0, "y": 31.0, "z": 330.0 }
  },
  "volume": 78234.56
}
```

---

## 🎮 Usage

### Getting Started

1. **Install Node.js** (v24.14.0 or higher)

2. **Clone and install dependencies:**
```bash
cd CoupledAI
npm install
```

3. **Set up backend environment:**
```bash
cd backend
cp .env.example .env
# Edit .env if needed (PORT=5001 by default)
```

4. **Start dev servers:**
```bash
# From project root
npm run dev
```

This starts:
- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:5001

### Uploading a Model

1. Click **"Upload Model"** button in toolbar (or "Choose File" in empty state)
2. Select an STL, OBJ, URDF, or DAE file
3. Model loads in 3D viewport
4. Information appears in **Robot Structure** panel (left)

### 3D Controls

- **Rotate**: Left-click + drag
- **Pan**: Right-click + drag
- **Zoom**: Scroll wheel
- **Reset View**: Reload page

### Supported File Formats

| Format | Extension | Geometry | Joints | Status |
|--------|-----------|----------|--------|--------|
| STL    | `.stl`    | ✅       | ❌     | Fully supported |
| OBJ    | `.obj`    | ✅       | ❌     | Fully supported |
| URDF   | `.urdf`   | ✅       | ✅     | Parser ready (Phase 2) |
| COLLADA| `.dae`    | ✅       | ⚠️     | Basic support |

**Note**: Currently only STL/OBJ have full 3D rendering. URDF parsing is implemented in backend but not yet connected to frontend (Phase 2 feature).

---

## 🔧 API Endpoints

### POST `/api/upload/model`
Upload a robot model file.

**Request:**
- Content-Type: `multipart/form-data`
- Body: `file` (binary)

**Response:**
```json
{
  "success": true,
  "file": {
    "filename": "1234567890-tube.stl",
    "originalName": "tube.stl",
    "size": 43520,
    "path": "/uploads/1234567890-tube.stl"
  }
}
```

### GET `/api/files/{filename}`
Retrieve uploaded file (static file serving).

### POST `/api/urdf/parse`
Parse URDF file and extract joint structure.

**Request:**
```json
{
  "filename": "robot.urdf"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "name": "MyRobot",
    "links": [...],
    "joints": [
      {
        "name": "base_joint",
        "type": "revolute",
        "parent": "base_link",
        "child": "arm_link",
        "axis": [0, 0, 1],
        "limits": { "lower": -1.57, "upper": 1.57, ... }
      }
    ]
  }
}
```

### POST `/api/analysis/code`
Analyze codebase with LLM (placeholder - Phase 4).

### GET `/api/health`
Health check endpoint.

---

## 🛠️ Development

### Project Commands

```bash
# Install all dependencies (root + frontend + backend)
npm install

# Start both dev servers concurrently
npm run dev

# Start only frontend (port 3000)
npm run dev:frontend

# Start only backend (port 5001)
npm run dev:backend

# Build for production
npm run build

# Lint all code
npm run lint

# Format code with Prettier
npm run format
```

### Frontend Development

```bash
cd frontend
npm run dev        # Start Vite dev server
npm run build      # Build for production
npm run preview    # Preview production build
```

### Backend Development

```bash
cd backend
npm run dev        # Start with tsx watch (auto-reload)
npm run build      # Compile TypeScript
npm run start      # Run compiled JS
```

### File Structure Conventions

- **Components**: PascalCase (e.g., `ModelViewer.tsx`)
- **Styles**: CSS Modules (e.g., `Panel.module.css`)
- **State**: Zustand stores in `src/store/`
- **Types**: Inline interfaces (considering separate `types/` folder)

---

## 🚧 Roadmap

### ✅ Phase 1: Foundation (COMPLETE)
- [x] Project setup and architecture
- [x] Dark theme UI with design system
- [x] 3D viewport with Three.js
- [x] STL/OBJ file upload and visualization
- [x] Automatic geometry analysis
- [x] Dynamic grid and camera positioning
- [x] Multi-panel layout

### 🔄 Phase 2: URDF Support (IN PROGRESS)
- [ ] Connect URDF parser to frontend
- [ ] Display joint hierarchy as tree
- [ ] Interactive joint selection in 3D
- [ ] Joint type badges (revolute, prismatic, etc.)
- [ ] Joint limits visualization

### 📋 Phase 3: Manual Annotation UI
- [ ] Click-to-add joint markers on STL models
- [ ] Joint labeling interface
- [ ] Save/load joint configurations
- [ ] Export to URDF format

### 🤖 Phase 4: LLM Code Analysis
- [ ] Upload codebase (zip file)
- [ ] Static code analysis (AST parsing)
- [ ] LLM prompt engineering for actuator detection
- [ ] Extract motor/joint mappings from code
- [ ] Display code-to-geometry mappings

### 🔗 Phase 5: Bidirectional Linking
- [ ] Click joint → highlight code
- [ ] Click code → highlight joint in 3D
- [ ] Control flow visualization
- [ ] Live variable inspection

### 🎛️ Phase 6: Joint Controls
- [ ] Slider controls for each joint
- [ ] Real-time joint animation in 3D
- [ ] Preset poses system
- [ ] Motion sequence playback

### 🧪 Phase 7: Testing with FTC Robots
- [ ] Test with 2-3 FTC robot models
- [ ] Validate mapping accuracy
- [ ] Usability testing with team members
- [ ] Performance benchmarking

### 🎨 Phase 8: Polish
- [ ] Code editor integration (Monaco)
- [ ] Export/share features
- [ ] Documentation generation
- [ ] Tutorial/onboarding flow

### 🚀 Stretch Goal: Natural Language Testing
- [ ] Chat interface for test generation
- [ ] LLM-generated unit tests
- [ ] Live robot integration
- [ ] Telemetry visualization

---

## 📝 Known Issues & Limitations

### Current Limitations
1. **STL/OBJ files have no joint information** - requires manual annotation or URDF export from CAD
2. **No code analysis yet** - Phase 4 feature
3. **No joint controls** - Phase 6 feature
4. **Single model at a time** - no multi-robot support
5. **No undo/redo** - will add with state history

### Performance Notes
- Large STL files (>10MB) may take time to load
- High polygon counts (>100k faces) may affect frame rate
- Grid render distance capped to prevent performance issues

### Browser Compatibility
- **Recommended**: Chrome/Edge (best WebGL performance)
- **Supported**: Firefox, Safari
- **Not tested**: Mobile browsers

---

## 🤝 Contributing

This is an academic senior project. External contributions are not currently accepted, but feedback is welcome!

### Development Guidelines
- Follow existing code style (enforced by ESLint + Prettier)
- Use TypeScript strictly (no `any` unless necessary)
- Keep components small and focused
- Document complex algorithms
- Test with multiple model sizes

---

## 📚 References

### Papers & Documentation
- URDF Specification: http://wiki.ros.org/urdf
- Three.js Documentation: https://threejs.org/docs/
- React Three Fiber: https://docs.pmnd.rs/react-three-fiber

### Related Work
- **RViz**: ROS visualization tool (requires ROS ecosystem)
- **Gazebo**: Physics-based robot simulator
- **Webots**: Commercial robot simulation platform
- **NVIDIA Isaac**: Advanced robotics simulation

---

## 📄 License

Academic project for **CPSC 4900 Senior Project**  
Georgia State University  
Spring 2026

---

## 👤 Contact

**Student**: Aarush Sharma  
**Advisor**: Prof. Timos Antonopoulos  
**Course**: CPSC 4900 - Senior Project  

For questions about this project, please contact through academic channels.

---

**Last Updated**: March 4, 2026

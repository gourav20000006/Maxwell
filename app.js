const svg = document.getElementById('plan-svg');
const status = document.getElementById('status');
const coords = document.getElementById('coords');
const snapToggle = document.getElementById('snap-toggle');
const deleteBtn = document.getElementById('delete-btn');
const clearBtn = document.getElementById('clear-btn');
const exportBtn = document.getElementById('export-btn');
const finishPolylineBtn = document.getElementById('finish-polyline-btn');
const toolButtons = document.querySelectorAll('.tool-btn');

const SVG_NS = 'http://www.w3.org/2000/svg';
const STORAGE_KEY = 'maxwell-plan-studio-state';
const GRID_SIZE = 20;
const SCALE_SQFT_PER_SQUARE = 0.1;

let tool = 'select';
let snapEnabled = true;
let shapes = [];
let selectedId = null;
let isDrawing = false;
let startPoint = null;
let previewShape = null;
let activePolyline = null;

function createSvgElement(name, attrs = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });
  return element;
}

function getViewBoxSize() {
  const [x, y, width, height] = svg.getAttribute('viewBox').split(' ').map(Number);
  return { x, y, width, height };
}

function snap(value) {
  return snapEnabled ? Math.round(value / GRID_SIZE) * GRID_SIZE : value;
}

function getPoint(event) {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const ctm = svg.getScreenCTM();

  if (!ctm) {
    return { x: 0, y: 0 };
  }

  const transformed = point.matrixTransform(ctm.inverse());
  return {
    x: snap(transformed.x),
    y: snap(transformed.y),
  };
}

function buildPolygonPoints(cx, cy, radius, sides) {
  const points = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = (index / sides) * Math.PI * 2 - Math.PI / 2;
    points.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  }
  return points;
}

function distance(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function computeArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

function computeMeasurement(shape) {
  switch (shape.type) {
    case 'room':
    case 'rectangle': {
      const widthSquares = shape.width / GRID_SIZE;
      const heightSquares = shape.height / GRID_SIZE;
      const area = widthSquares * heightSquares * SCALE_SQFT_PER_SQUARE;
      return [`${widthSquares.toFixed(1)} × ${heightSquares.toFixed(1)} squares`, `${area.toFixed(2)} sqft`];
    }
    case 'circle': {
      const radiusSquares = shape.r / GRID_SIZE;
      const area = Math.PI * radiusSquares * radiusSquares * SCALE_SQFT_PER_SQUARE;
      return [`R ${radiusSquares.toFixed(1)} sq`, `${area.toFixed(2)} sqft`];
    }
    case 'ellipse': {
      const rxSquares = shape.rx / GRID_SIZE;
      const rySquares = shape.ry / GRID_SIZE;
      const area = Math.PI * rxSquares * rySquares * SCALE_SQFT_PER_SQUARE;
      return [`Rx ${rxSquares.toFixed(1)} sq`, `Ry ${rySquares.toFixed(1)} sq`, `${area.toFixed(2)} sqft`];
    }
    case 'line':
    case 'wall':
    case 'arc': {
      const length = distance(shape.x1, shape.y1, shape.x2, shape.y2);
      const squares = length / GRID_SIZE;
      return [`Length ${squares.toFixed(1)} squares`];
    }
    case 'polygon': {
      const areaPx = computeArea(shape.points);
      const area = (areaPx / (GRID_SIZE * GRID_SIZE)) * SCALE_SQFT_PER_SQUARE;
      return [`${area.toFixed(2)} sqft`];
    }
    case 'polyline': {
      let length = 0;
      for (let i = 1; i < shape.points.length; i += 1) {
        length += distance(shape.points[i - 1].x, shape.points[i - 1].y, shape.points[i].x, shape.points[i].y);
      }
      const squares = length / GRID_SIZE;
      return [`Length ${squares.toFixed(1)} squares`];
    }
    default:
      return [];
  }
}

function createMeasurementLabel(shape) {
  const lines = computeMeasurement(shape);
  if (!lines.length) {
    return null;
  }

  let x = 0;
  let y = 0;

  switch (shape.type) {
    case 'room':
    case 'rectangle':
      x = shape.x + 6;
      y = shape.y + 16;
      break;
    case 'circle':
    case 'ellipse':
      x = shape.cx + 6;
      y = shape.cy - 6;
      break;
    case 'line':
    case 'wall':
    case 'arc': {
      x = (shape.x1 + shape.x2) / 2 + 6;
      y = (shape.y1 + shape.y2) / 2 - 6;
      break;
    }
    case 'polygon':
      x = shape.points[0].x + 6;
      y = shape.points[0].y - 6;
      break;
    case 'polyline':
      x = shape.points[shape.points.length - 1].x + 6;
      y = shape.points[shape.points.length - 1].y - 6;
      break;
    default:
      return null;
  }

  const textGroup = createSvgElement('g', { class: 'measurement-group' });
  lines.forEach((line, index) => {
    const textElement = createSvgElement('text', {
      x,
      y: y + index * 14,
      fill: '#0f172a',
      'font-size': 12,
      'font-family': 'Inter, system-ui, sans-serif',
    });
    textElement.appendChild(document.createTextNode(line));
    textGroup.appendChild(textElement);
  });
  return textGroup;
}

function getShapeBounds(shape) {
  switch (shape.type) {
    case 'room':
      return {
        x: shape.x - 4,
        y: shape.y - 4,
        width: shape.width + 8,
        height: shape.height + 8,
      };
    case 'wall':
      return {
        x: Math.min(shape.x1, shape.x2) - 4,
        y: Math.min(shape.y1, shape.y2) - 4,
        width: Math.abs(shape.x2 - shape.x1) + 8,
        height: Math.abs(shape.y2 - shape.y1) + 8,
      };
    case 'line':
      return {
        x: Math.min(shape.x1, shape.x2) - 4,
        y: Math.min(shape.y1, shape.y2) - 4,
        width: Math.abs(shape.x2 - shape.x1) + 8,
        height: Math.abs(shape.y2 - shape.y1) + 8,
      };
    case 'rectangle':
      return {
        x: shape.x - 4,
        y: shape.y - 4,
        width: shape.width + 8,
        height: shape.height + 8,
      };
    case 'circle':
      return {
        x: shape.cx - shape.r - 4,
        y: shape.cy - shape.r - 4,
        width: shape.r * 2 + 8,
        height: shape.r * 2 + 8,
      };
    case 'ellipse':
      return {
        x: shape.cx - shape.rx - 4,
        y: shape.cy - shape.ry - 4,
        width: shape.rx * 2 + 8,
        height: shape.ry * 2 + 8,
      };
    case 'polygon':
      return {
        x: Math.min(...shape.points.map((point) => point.x)) - 4,
        y: Math.min(...shape.points.map((point) => point.y)) - 4,
        width: Math.max(...shape.points.map((point) => point.x)) - Math.min(...shape.points.map((point) => point.x)) + 8,
        height: Math.max(...shape.points.map((point) => point.y)) - Math.min(...shape.points.map((point) => point.y)) + 8,
      };
    case 'arc':
      return {
        x: Math.min(shape.x1, shape.x2) - 4,
        y: Math.min(shape.y1, shape.y2) - 4,
        width: Math.abs(shape.x2 - shape.x1) + 8,
        height: Math.abs(shape.y2 - shape.y1) + 8,
      };
    case 'polyline':
      return {
        x: Math.min(...shape.points.map((point) => point.x)) - 4,
        y: Math.min(...shape.points.map((point) => point.y)) - 4,
        width: Math.max(...shape.points.map((point) => point.x)) - Math.min(...shape.points.map((point) => point.x)) + 8,
        height: Math.max(...shape.points.map((point) => point.y)) - Math.min(...shape.points.map((point) => point.y)) + 8,
      };
    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

function render() {
  svg.innerHTML = '';

  const { width, height } = getViewBoxSize();
  const defs = createSvgElement('defs');
  const pattern = createSvgElement('pattern', {
    id: 'grid',
    width: GRID_SIZE,
    height: GRID_SIZE,
    patternUnits: 'userSpaceOnUse',
  });
  pattern.appendChild(
    createSvgElement('path', {
      d: `M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`,
      fill: 'none',
      stroke: '#e2e8f0',
      'stroke-width': 1,
    })
  );
  defs.appendChild(pattern);
  svg.appendChild(defs);

  svg.appendChild(
    createSvgElement('rect', {
      x: 0,
      y: 0,
      width,
      height,
      fill: 'url(#grid)',
    })
  );

  shapes.forEach((shape) => {
    const group = createSvgElement('g', { 'data-shape-id': shape.id });

    if (shape.type === 'room') {
      group.appendChild(
        createSvgElement('rect', {
          x: shape.x,
          y: shape.y,
          width: shape.width,
          height: shape.height,
          rx: 6,
          fill: shape.fill,
          stroke: shape.stroke,
          'stroke-width': shape.strokeWidth,
        })
      );
    } else if (shape.type === 'wall') {
      group.appendChild(
        createSvgElement('line', {
          x1: shape.x1,
          y1: shape.y1,
          x2: shape.x2,
          y2: shape.y2,
          stroke: shape.stroke,
          'stroke-width': shape.strokeWidth,
          'stroke-linecap': 'round',
        })
      );
    } else if (shape.type === 'line') {
      group.appendChild(
        createSvgElement('line', {
          x1: shape.x1,
          y1: shape.y1,
          x2: shape.x2,
          y2: shape.y2,
          stroke: shape.stroke,
          'stroke-width': shape.strokeWidth,
          'stroke-linecap': 'round',
        })
      );
    } else if (shape.type === 'rectangle') {
      group.appendChild(
        createSvgElement('rect', {
          x: shape.x,
          y: shape.y,
          width: shape.width,
          height: shape.height,
          fill: shape.fill,
          stroke: shape.stroke,
          'stroke-width': shape.strokeWidth,
        })
      );
    } else if (shape.type === 'circle') {
      group.appendChild(
        createSvgElement('circle', {
          cx: shape.cx,
          cy: shape.cy,
          r: shape.r,
          fill: shape.fill,
          stroke: shape.stroke,
          'stroke-width': shape.strokeWidth,
        })
      );
    } else if (shape.type === 'ellipse') {
      group.appendChild(
        createSvgElement('ellipse', {
          cx: shape.cx,
          cy: shape.cy,
          rx: shape.rx,
          ry: shape.ry,
          fill: shape.fill,
          stroke: shape.stroke,
          'stroke-width': shape.strokeWidth,
        })
      );
    } else if (shape.type === 'arc') {
      group.appendChild(
        createSvgElement('path', {
          d: shape.d,
          fill: 'none',
          stroke: shape.stroke,
          'stroke-width': shape.strokeWidth,
          'stroke-linecap': 'round',
        })
      );
    } else if (shape.type === 'polygon') {
      group.appendChild(
        createSvgElement('polygon', {
          points: shape.points.map((point) => `${point.x},${point.y}`).join(' '),
          fill: shape.fill,
          stroke: shape.stroke,
          'stroke-width': shape.strokeWidth,
        })
      );
    } else if (shape.type === 'polyline') {
      group.appendChild(
        createSvgElement('polyline', {
          points: shape.points.map((point) => `${point.x},${point.y}`).join(' '),
          fill: 'none',
          stroke: shape.stroke,
          'stroke-width': shape.strokeWidth,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        })
      );
    }

    if (selectedId === shape.id) {
      const bounds = getShapeBounds(shape);
      group.appendChild(
        createSvgElement('rect', {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          fill: 'none',
          stroke: '#2563eb',
          'stroke-width': 2,
          'stroke-dasharray': '6 6',
        })
      );
    }

    const measurementGroup = createMeasurementLabel(shape);
    if (measurementGroup) {
      svg.appendChild(measurementGroup);
    }

    svg.appendChild(group);
  });

  if (previewShape) {
    const preview = createSvgElement('g', { 'data-preview': 'true' });

    if (previewShape.type === 'room') {
      preview.appendChild(
        createSvgElement('rect', {
          x: Math.min(previewShape.x1, previewShape.x2),
          y: Math.min(previewShape.y1, previewShape.y2),
          width: Math.abs(previewShape.x2 - previewShape.x1),
          height: Math.abs(previewShape.y2 - previewShape.y1),
          rx: 6,
          fill: 'rgba(37, 99, 235, 0.15)',
          stroke: '#2563eb',
          'stroke-width': 2,
          'stroke-dasharray': '6 6',
        })
      );
    } else if (previewShape.type === 'wall') {
      preview.appendChild(
        createSvgElement('line', {
          x1: previewShape.x1,
          y1: previewShape.y1,
          x2: previewShape.x2,
          y2: previewShape.y2,
          stroke: '#0f172a',
          'stroke-width': 4,
          'stroke-linecap': 'round',
          'stroke-dasharray': '8 6',
        })
      );
    } else if (previewShape.type === 'line') {
      preview.appendChild(
        createSvgElement('line', {
          x1: previewShape.x1,
          y1: previewShape.y1,
          x2: previewShape.x2,
          y2: previewShape.y2,
          stroke: '#2563eb',
          'stroke-width': 2,
          'stroke-dasharray': '8 6',
        })
      );
    } else if (previewShape.type === 'rectangle') {
      preview.appendChild(
        createSvgElement('rect', {
          x: Math.min(previewShape.x1, previewShape.x2),
          y: Math.min(previewShape.y1, previewShape.y2),
          width: Math.abs(previewShape.x2 - previewShape.x1),
          height: Math.abs(previewShape.y2 - previewShape.y1),
          fill: 'rgba(37, 99, 235, 0.12)',
          stroke: '#2563eb',
          'stroke-width': 2,
          'stroke-dasharray': '6 6',
        })
      );
    } else if (previewShape.type === 'circle') {
      const cx = (previewShape.x1 + previewShape.x2) / 2;
      const cy = (previewShape.y1 + previewShape.y2) / 2;
      const r = Math.hypot(previewShape.x2 - previewShape.x1, previewShape.y2 - previewShape.y1) / 2;
      preview.appendChild(
        createSvgElement('circle', {
          cx,
          cy,
          r,
          fill: 'rgba(37, 99, 235, 0.12)',
          stroke: '#2563eb',
          'stroke-width': 2,
          'stroke-dasharray': '6 6',
        })
      );
    } else if (previewShape.type === 'ellipse') {
      const cx = (previewShape.x1 + previewShape.x2) / 2;
      const cy = (previewShape.y1 + previewShape.y2) / 2;
      const rx = Math.abs(previewShape.x2 - previewShape.x1) / 2;
      const ry = Math.abs(previewShape.y2 - previewShape.y1) / 2;
      preview.appendChild(
        createSvgElement('ellipse', {
          cx,
          cy,
          rx,
          ry,
          fill: 'rgba(37, 99, 235, 0.12)',
          stroke: '#2563eb',
          'stroke-width': 2,
          'stroke-dasharray': '6 6',
        })
      );
    } else if (previewShape.type === 'arc') {
      const radius = Math.max(10, Math.hypot(previewShape.x2 - previewShape.x1, previewShape.y2 - previewShape.y1) / 2);
      const largeArcFlag = Math.abs(previewShape.x2 - previewShape.x1) > Math.abs(previewShape.y2 - previewShape.y1) ? 0 : 1;
      preview.appendChild(
        createSvgElement('path', {
          d: `M ${previewShape.x1} ${previewShape.y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${previewShape.x2} ${previewShape.y2}`,
          fill: 'none',
          stroke: '#2563eb',
          'stroke-width': 2,
          'stroke-dasharray': '6 6',
        })
      );
    } else if (previewShape.type === 'polygon') {
      const cx = (previewShape.x1 + previewShape.x2) / 2;
      const cy = (previewShape.y1 + previewShape.y2) / 2;
      const radius = Math.hypot(previewShape.x2 - previewShape.x1, previewShape.y2 - previewShape.y1) / 2;
      const points = buildPolygonPoints(cx, cy, radius, 6).map((point) => `${point.x},${point.y}`).join(' ');
      preview.appendChild(
        createSvgElement('polygon', {
          points,
          fill: 'rgba(37, 99, 235, 0.12)',
          stroke: '#2563eb',
          'stroke-width': 2,
          'stroke-dasharray': '6 6',
        })
      );
    } else if (previewShape.type === 'polyline') {
      const points = previewShape.lastPoint
        ? [...previewShape.points, previewShape.lastPoint]
        : previewShape.points;
      preview.appendChild(
        createSvgElement('polyline', {
          points: points.map((point) => `${point.x},${point.y}`).join(' '),
          fill: 'none',
          stroke: '#2563eb',
          'stroke-width': 2,
          'stroke-dasharray': '8 6',
          'stroke-linejoin': 'round',
          'stroke-linecap': 'round',
        })
      );
    }

    svg.appendChild(preview);
  }

  saveState();
  updateStatus();
}

function updateStatus() {
  status.textContent = `Tool: ${tool.charAt(0).toUpperCase() + tool.slice(1)}`;
  const selectedShape = shapes.find((shape) => shape.id === selectedId);
  if (selectedShape) {
    coords.textContent = `${selectedShape.type} selected`;
  } else {
    coords.textContent = 'Ready';
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(shapes));
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return;
  }

  try {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      shapes = parsed;
    }
  } catch (error) {
    console.error('Unable to restore saved plan', error);
  }
}

function setTool(nextTool) {
  tool = nextTool;
  toolButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === tool);
  });
  updateStatus();
}

function addShape(shape) {
  shapes.push(shape);
  selectedId = shape.id;
  render();
}

function removeSelected() {
  if (!selectedId) {
    return;
  }

  shapes = shapes.filter((shape) => shape.id !== selectedId);
  selectedId = null;
  render();
}

function clearPlan() {
  shapes = [];
  selectedId = null;
  activePolyline = null;
  previewShape = null;
  render();
}

function finishPolyline() {
  activePolyline = null;
  previewShape = null;
  render();
}

function exportSvg() {
  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(svg);
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'building-plan.svg';
  link.click();
  URL.revokeObjectURL(url);
}

function beginDraw(point) {
  if (tool === 'select') {
    return;
  }

  if (tool === 'polyline') {
    if (!activePolyline) {
      activePolyline = {
        id: crypto.randomUUID(),
        type: 'polyline',
        points: [{ x: point.x, y: point.y }],
        stroke: '#0f172a',
        strokeWidth: 4,
      };
      shapes.push(activePolyline);
      selectedId = activePolyline.id;
      previewShape = {
        type: 'polyline',
        points: activePolyline.points.slice(),
        lastPoint: { x: point.x, y: point.y },
      };
    } else {
      activePolyline.points.push({ x: point.x, y: point.y });
      previewShape = {
        type: 'polyline',
        points: activePolyline.points.slice(),
        lastPoint: { x: point.x, y: point.y },
      };
    }
    render();
    return;
  }

  isDrawing = true;
  startPoint = point;
  previewShape = {
    type: tool,
    x1: point.x,
    y1: point.y,
    x2: point.x,
    y2: point.y,
  };
  render();
}

function updateDraw(point) {
  if (tool === 'polyline') {
    if (activePolyline) {
      previewShape = {
        type: 'polyline',
        points: activePolyline.points.slice(),
        lastPoint: { x: point.x, y: point.y },
      };
      render();
    }
    return;
  }

  if (!isDrawing || !previewShape) {
    return;
  }

  previewShape.x2 = point.x;
  previewShape.y2 = point.y;
  render();
}

function finishDraw(point) {
  if (!isDrawing || !previewShape || !startPoint) {
    return;
  }

  const x1 = startPoint.x;
  const y1 = startPoint.y;
  const x2 = point.x;
  const y2 = point.y;
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);

  if (tool === 'line' && Math.max(width, height) > 2) {
    addShape({
      id: crypto.randomUUID(),
      type: 'line',
      x1,
      y1,
      x2,
      y2,
      stroke: '#0f172a',
      strokeWidth: 3,
    });
  } else if (tool === 'rectangle' && width > 4 && height > 4) {
    addShape({
      id: crypto.randomUUID(),
      type: 'rectangle',
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width,
      height,
      fill: 'none',
      stroke: '#0f172a',
      strokeWidth: 2,
    });
  } else if (tool === 'circle' && Math.max(width, height) > 4) {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const r = Math.hypot(x2 - x1, y2 - y1) / 2;
    addShape({
      id: crypto.randomUUID(),
      type: 'circle',
      cx,
      cy,
      r,
      fill: 'none',
      stroke: '#0f172a',
      strokeWidth: 2,
    });
  } else if (tool === 'ellipse' && Math.max(width, height) > 4) {
    addShape({
      id: crypto.randomUUID(),
      type: 'ellipse',
      cx: (x1 + x2) / 2,
      cy: (y1 + y2) / 2,
      rx: Math.abs(x2 - x1) / 2,
      ry: Math.abs(y2 - y1) / 2,
      fill: 'none',
      stroke: '#0f172a',
      strokeWidth: 2,
    });
  } else if (tool === 'arc' && Math.max(width, height) > 4) {
    const radius = Math.max(10, Math.hypot(x2 - x1, y2 - y1) / 2);
    const largeArcFlag = Math.abs(x2 - x1) > Math.abs(y2 - y1) ? 0 : 1;
    addShape({
      id: crypto.randomUUID(),
      type: 'arc',
      x1,
      y1,
      x2,
      y2,
      d: `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
      stroke: '#0f172a',
      strokeWidth: 3,
    });
  } else if (tool === 'polygon' && Math.max(width, height) > 4) {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const radius = Math.hypot(x2 - x1, y2 - y1) / 2;
    addShape({
      id: crypto.randomUUID(),
      type: 'polygon',
      points: buildPolygonPoints(cx, cy, radius, 6),
      fill: 'none',
      stroke: '#0f172a',
      strokeWidth: 2,
    });
  } else if (tool === 'room' && width > 4 && height > 4) {
    addShape({
      id: crypto.randomUUID(),
      type: 'room',
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width,
      height,
      fill: '#eff6ff',
      stroke: '#2563eb',
      strokeWidth: 2,
    });
  } else if (tool === 'wall' && Math.max(width, height) > 2) {
    addShape({
      id: crypto.randomUUID(),
      type: 'wall',
      x1,
      y1,
      x2,
      y2,
      stroke: '#0f172a',
      strokeWidth: 4,
    });
  }

  isDrawing = false;
  startPoint = null;
  previewShape = null;
  render();
}

svg.addEventListener('pointerdown', (event) => {
  const point = getPoint(event);
  const shapeTarget = event.target.closest('[data-shape-id]');

  if (tool === 'select') {
    if (shapeTarget) {
      selectedId = shapeTarget.getAttribute('data-shape-id');
      render();
    } else {
      selectedId = null;
      render();
    }
    return;
  }

  if (tool === 'polyline') {
    beginDraw(point);
    return;
  }

  beginDraw(point);
  svg.setPointerCapture(event.pointerId);
  event.preventDefault();
});

svg.addEventListener('pointermove', (event) => {
  const point = getPoint(event);
  coords.textContent = `${Math.round(point.x)},${Math.round(point.y)}`;
  if (tool === 'polyline') {
    updateDraw(point);
  } else if (isDrawing) {
    updateDraw(point);
  }
});

svg.addEventListener('pointerup', (event) => {
  if (tool === 'polyline') {
    return;
  }

  const point = getPoint(event);
  if (isDrawing) {
    finishDraw(point);
  }
  if (svg.hasPointerCapture(event.pointerId)) {
    svg.releasePointerCapture(event.pointerId);
  }
});

svg.addEventListener('pointerleave', () => {
  if (!isDrawing) {
    return;
  }
  coords.textContent = 'Drawing';
});

toolButtons.forEach((button) => {
  button.addEventListener('click', () => setTool(button.dataset.tool));
});

snapToggle.addEventListener('change', () => {
  snapEnabled = snapToggle.checked;
  render();
});

finishPolylineBtn.addEventListener('click', finishPolyline);
deleteBtn.addEventListener('click', removeSelected);
clearBtn.addEventListener('click', clearPlan);
exportBtn.addEventListener('click', exportSvg);

document.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (event.key === 'Delete' || event.key === 'Backspace') {
    removeSelected();
  }
  if (key === 'l') {
    setTool('line');
  }
  if (key === 'p') {
    setTool('polyline');
  }
  if (key === 'c') {
    setTool('circle');
  }
  if (key === 'r') {
    setTool('rectangle');
  }
  if (key === 'a') {
    setTool('arc');
  }
  if (key === 'o') {
    setTool('polygon');
  }
  if (key === 'e') {
    setTool('ellipse');
  }
  if (key === 'escape') {
    finishPolyline();
  }
  if (key === 'enter') {
    finishPolyline();
  }
});

loadState();
render();

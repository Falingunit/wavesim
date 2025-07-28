// ----- Default values for snapping and controls -----
const defaults = {
  animInterval: "20",
  yScale: "1.5",
  stringLength: "1.0",
  tension: "1.0",
  massDensity: "1.0",
  damping: "0",
  resolution: "101",
  functionInput: "0.5*Math.sin(2*Math.PI*t)"
};

// Define snapping parameters:
const SNAP_THRESHOLD = 1000; // ms to hold near zero before snapping
const SNAP_EPSILON = 0.1;    // tolerance for "near zero"
let snapStartTime = null;

// ------------------------------
// Simulation Parameters & Globals
// ------------------------------
let r = 0.5; // Courant number
let T_total = 10.0; // Total simulation time

// Physical parameters (initial values from controls)
let L = parseFloat(document.getElementById('stringLength').value);
let tension = parseFloat(document.getElementById('tension').value);
let mu = parseFloat(document.getElementById('massDensity').value);
let gamma = parseFloat(document.getElementById('damping').value);
let N = parseInt(document.getElementById('resolution').value);

// Derived parameters
let c = Math.sqrt(tension / mu);
let dx = L / (N - 1);
let dt = r * dx / c; // simulation time step in seconds
let timeElapsed = dt;

// Global left boundary value for manual control (initially 0)
let leftBoundaryValue = 0;

let editRequired = true;

// Constant for the left boundary handle radius.
const handleRadius = 10;

// Create arrays for the string's displacement (main simulation)
let u_previous = new Array(N).fill(0);
let u_current = new Array(N).fill(0);
let u_next = new Array(N).fill(0);

// Initialize main simulation state (zero displacement; using Taylor expansion for first step)
function resetMainSimulationState() {
  timeElapsed = 0;
  u_previous = new Array(N).fill(0);
  u_current = new Array(N).fill(0);
  u_next = new Array(N).fill(0);
  for (let i = 1; i < N - 1; i++) {
    u_current[i] = u_previous[i] + 0.5 * r * r * (u_previous[i + 1] - 2 * u_previous[i] + u_previous[i - 1]);
  }
  leftBoundaryValue = 0;
}
resetMainSimulationState();

// Get canvas and context
const canvas = document.getElementById('waveCanvas');
const ctx = canvas.getContext('2d');
const width = canvas.width;
const height = canvas.height;

// Control variables
let paused = false;
let controlMode = "manual";  // "manual" or "function"
let animInterval = parseInt(document.getElementById('animInterval').value);
let yScale = parseFloat(defaults.yScale);  // initial yScale

// ------------------------------
// Variables for Vertical Axis Zooming (via vertical dragging)
// ------------------------------
let draggingAxis = false;
let initialAxisMouseY = 0;      
let initialAxisYScale = yScale;
const AXIS_DRAG_THRESHOLD = 15;
const ZOOM_SENSITIVITY = 0.005;

// ------------------------------
// Two-Way Binding for Other Sliders/Inputs (excluding yScale)
// ------------------------------
function bindSlider(sliderId, inputId, defaultVal) {
  const slider = document.getElementById(sliderId);
  const input = document.getElementById(inputId);
  slider.addEventListener('input', function() {
    input.value = this.value;
  });
  input.addEventListener('change', function() {
    slider.value = this.value;
  });
  input.addEventListener('dblclick', function() {
    this.value = defaultVal;
    slider.value = defaultVal;
  });
}
bindSlider('animInterval', 'animIntervalInput', defaults.animInterval);
bindSlider('stringLength', 'stringLengthInput', defaults.stringLength);
bindSlider('tension', 'tensionInput', defaults.tension);
bindSlider('massDensity', 'massDensityInput', defaults.massDensity);
bindSlider('damping', 'dampingInput', defaults.damping);
bindSlider('resolution', 'resolutionInput', defaults.resolution);

// ------------------------------
// Utility Functions
// ------------------------------
function getNiceGridSpacing(range, targetPx, canvasSize) {
  let rawSpacing = range / (canvasSize / targetPx);
  let exponent = Math.floor(Math.log10(rawSpacing));
  let fraction = rawSpacing / Math.pow(10, exponent);
  let niceFraction;
  if (fraction < 1.5) {
    niceFraction = 1;
  } else if (fraction < 3) {
    niceFraction = 2;
  } else if (fraction < 7) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

function simToCanvas(xSim, ySim) {
  let xCanvas = (xSim / L) * width;
  let yCanvas = height / 2 - (ySim / yScale * (height / 2));
  return { x: xCanvas, y: yCanvas };
}

function canvasToSimY(yCanvas) {
  return ((height / 2 - yCanvas) / (height / 2)) * yScale;
}

// ------------------------------
// Function Evaluation for Left Boundary
// ------------------------------
// Use applied functions stored in the table rows when in "function" control mode.
function leftBoundary(t) {
  if (controlMode === "manual") {
    return leftBoundaryValue;
  } else {
    let total = 0;
    // Loop through each row and get its applied function.
    const rows = document.querySelectorAll('#functionTable tbody tr');
    rows.forEach(row => {
      const appliedExpr = row.dataset.appliedFunction;
      if (appliedExpr) {
        try {
          total += math.evaluate(appliedExpr, { t: t });
        } catch (e) {
          console.error("Error evaluating applied function:", e);
        }
      }
    });
    return total;
  }
}

function getHandlePosition() {
  let currentY = controlMode === "manual" ? leftBoundaryValue : leftBoundary(timeElapsed);
  let pos = simToCanvas(0, currentY);
  pos.x = Math.max(handleRadius, pos.x);
  return pos;
}

// ------------------------------
// Drawing Function
// ------------------------------
function drawWave() {
  ctx.clearRect(0, 0, width, height);
  
  // Draw vertical grid lines:
  let targetPxX = 50;
  let xSpacing = getNiceGridSpacing(L, targetPxX, width);
  for (let x = 0; x <= L; x += xSpacing) {
    let xCanvas = (x / L) * width;
    ctx.beginPath();
    ctx.moveTo(xCanvas, 0);
    ctx.lineTo(xCanvas, height);
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#e0e0e0";
    ctx.font = "10px Arial";
    ctx.fillText(x.toFixed(2), xCanvas + 2, height - 2);
  }
  
  // Draw horizontal grid lines:
  let targetPxY = 50;
  let yRange = 2 * yScale;
  let ySpacing = getNiceGridSpacing(yRange, targetPxY, height);
  let yStart = Math.ceil((-yScale) / ySpacing) * ySpacing;
  for (let y = yStart; y <= yScale; y += ySpacing) {
    let pt1 = simToCanvas(0, y);
    let pt2 = simToCanvas(L, y);
    ctx.beginPath();
    ctx.moveTo(pt1.x, pt1.y);
    ctx.lineTo(pt2.x, pt2.y);
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#e0e0e0";
    ctx.font = "10px Arial";
    ctx.fillText(y.toFixed(2), 2, pt1.y - 2);
  }
  
  // Draw the main string (wave) if main simulation is enabled
  let simulateMainEl = document.getElementById("simulateMain");
  let simulateMain = simulateMainEl ? simulateMainEl.checked : true;
  if (simulateMain) {
    // Set line pattern for the main wave
    let mainPatternEl = document.getElementById("mainWavePattern");
    if (mainPatternEl) {
      let pattern = mainPatternEl.value;
      if (pattern === "dashed") {
        ctx.setLineDash([10, 10]);
      } else if (pattern === "dotted") {
        ctx.setLineDash([2, 6]);
      } else {
        ctx.setLineDash([]);
      }
    }
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      let point = simToCanvas(i * dx, u_current[i]);
      if (i === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.strokeStyle = "blue";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]); // reset dash
  }
  
  // Draw left boundary handle
  let handle = getHandlePosition();
  ctx.beginPath();
  ctx.arc(handle.x, handle.y, handleRadius, 0, 2 * Math.PI);
  ctx.fillStyle = controlMode === "manual" ? "#f00" : "#808080";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.stroke();
  
  // Draw vertical axis for zooming
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, height);
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ------------------------------
// Simulation Update Function (Main Simulation)
// ------------------------------
function updateSimulation() {
  for (let i = 1; i < N - 1; i++) {
    u_next[i] = (2 * u_current[i] - (1 + gamma * dt / 2) * u_previous[i] +
      r * r * (u_current[i + 1] - 2 * u_current[i] + u_current[i - 1])) /
      (1 + gamma * dt / 2);
  }
  
  // Left boundary using the current control mode:
  u_next[0] = leftBoundary(timeElapsed + dt);
  
  // Right boundary condition:
  const rightEndOption = document.querySelector('input[name="rightEnd"]:checked').value;
  if (rightEndOption === "fixed") {
    u_next[N - 1] = 0;
  } else if (rightEndOption === "free") {
    u_next[N - 1] = u_next[N - 2];
  } else if (rightEndOption === "infinite") {
    let alpha = (c * dt - dx) / (c * dt + dx);
    u_next[N - 1] = u_current[N - 2] + alpha * (u_next[N - 2] - u_current[N - 1]);
  }
  
  u_previous = u_current.slice();
  u_current = u_next.slice();
  timeElapsed += dt;
}

// ------------------------------
// Extra Simulations for Function Rows
// ------------------------------
// Global container for extra simulations (keyed by row id)
let extraSimulations = {};
let functionCounter = 1; // start counter for new rows

// Function to create a new simulation state object for extra simulations
function initExtraSimulation() {
  return {
    u_previous: new Array(N).fill(0),
    u_current: new Array(N).fill(0),
    u_next: new Array(N).fill(0),
    timeElapsed: timeElapsed // will be reset to global time when simulation is toggled on
  };
}

// Reset function for an extra simulation row – synchronizes its time with global time
function resetExtraSimulation(rowId) {
  let sim = initExtraSimulation();
  // Set simulation time to current global time
  sim.timeElapsed = timeElapsed;
  // Initialize extra simulation state similar to main simulation
  for (let i = 1; i < N - 1; i++) {
    sim.u_current[i] = sim.u_previous[i] + 0.5 * r * r * (sim.u_previous[i + 1] - 2 * sim.u_previous[i] + sim.u_previous[i - 1]);
  }
  extraSimulations[rowId] = sim;
}

// Update function for an extra simulation given its function f
function updateExtraSimulation(sim, f) {
  for (let i = 1; i < N - 1; i++) {
    sim.u_next[i] = (2 * sim.u_current[i] - (1 + gamma * dt / 2) * sim.u_previous[i] +
      r * r * (sim.u_current[i + 1] - 2 * sim.u_current[i] + sim.u_current[i - 1])) /
      (1 + gamma * dt / 2);
  }
  
  // Left boundary: evaluate using the row's applied function.
  sim.u_next[0] = math.evaluate(f, { t: sim.timeElapsed + dt });
  
  // Right boundary (same as main simulation)
  const rightEndOption = document.querySelector('input[name="rightEnd"]:checked').value;
  if (rightEndOption === "fixed") {
    sim.u_next[N - 1] = 0;
  } else if (rightEndOption === "free") {
    sim.u_next[N - 1] = sim.u_next[N - 2];
  } else if (rightEndOption === "infinite") {
    let alpha = (c * dt - dx) / (c * dt + dx);
    sim.u_next[N - 1] = sim.u_current[N - 2] + alpha * (sim.u_next[N - 2] - sim.u_current[N - 1]);
  }
  
  sim.u_previous = sim.u_current.slice();
  sim.u_current = sim.u_next.slice();
  sim.timeElapsed += dt; // keep in sync with global time
}

function drawExtraSimulation(sim, color, pattern) {
  if (pattern === "dashed") {
    ctx.setLineDash([10, 10]);
  } else if (pattern === "dotted") {
    ctx.setLineDash([2, 6]);
  } else {
    ctx.setLineDash([]);
  }
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    let point = simToCanvas(i * dx, sim.u_current[i]);
    if (i === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);
}

// ------------------------------
// Main Animation Loop using requestAnimationFrame
// ------------------------------
let lastTime = performance.now();
let accumulator = 0;
const defaultAnimInterval = 20;

function mainLoop(currentTime) {
  let frameTime = (currentTime - lastTime) / 1000;
  lastTime = currentTime;
  accumulator += frameTime;
  
  let effectiveDt = dt * (animInterval / defaultAnimInterval);
  
  while (accumulator >= effectiveDt) {
    if (!paused) {
      // Update main simulation only if its simulate checkbox is checked
      let simulateMainEl = document.getElementById("simulateMain");
      let simulateMain = simulateMainEl ? simulateMainEl.checked : true;
      if (simulateMain) {
        updateSimulation();
      }
      
      // Update each extra simulation if its row's simulate checkbox is checked
      document.querySelectorAll('#functionTable tbody tr').forEach(row => {
        const simulateCheckbox = row.querySelector('.simulate-checkbox');
        const rowId = row.getAttribute('data-row-id');
        
        if (simulateCheckbox.checked && extraSimulations[rowId]) {
          // Use the applied function (stored in dataset) rather than the live input value.
          const appliedExpr = row.dataset.appliedFunction;
          if (appliedExpr) {
            updateExtraSimulation(extraSimulations[rowId], appliedExpr);
          }
        }
      });
    }
    accumulator -= effectiveDt;
  }
  
  // Draw main wave
  drawWave();
  
  // Draw extra simulation waves
  Object.keys(extraSimulations).forEach(rowId => {
    const row = document.querySelector(`#functionTable tbody tr[data-row-id="${rowId}"]`);
    if (row) {
      const color = row.querySelector('.function-color').value;
      const patternSelect = row.querySelector('.line-pattern');
      const pattern = patternSelect ? patternSelect.value : "solid";
      drawExtraSimulation(extraSimulations[rowId], color, pattern);
    }
  });
  
  // Update time display in function mode
  if (controlMode === "function") {
    const timeDisplay = document.getElementById("functionTimeDisplay");
    if (timeDisplay) {
      timeDisplay.textContent = "Time: " + timeElapsed.toFixed(2) + " s";
    }
  }
  
  requestAnimationFrame(mainLoop);
}
requestAnimationFrame(mainLoop);

// ------------------------------
// Canvas Event Listeners for Left Boundary & Zooming
// ------------------------------
let draggingLeftBoundary = false;

function getMousePos(evt) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: evt.clientX - rect.left,
    y: evt.clientY - rect.top
  };
}

canvas.addEventListener('mousedown', function(evt) {
  const pos = getMousePos(evt);
  
  if (controlMode === "manual") {
    const handlePos = getHandlePosition();
    const dist = Math.hypot(pos.x - handlePos.x, pos.y - handlePos.y);
    if (dist < handleRadius) {
      draggingLeftBoundary = true;
      return;
    }
  }
  
  if (pos.x < AXIS_DRAG_THRESHOLD) {
    draggingAxis = true;
    initialAxisMouseY = pos.y;
    initialAxisYScale = yScale;
  }
});

canvas.addEventListener('mousemove', function(evt) {
  const pos = getMousePos(evt);
  
  if (draggingLeftBoundary && controlMode === "manual") {
    let newY = canvasToSimY(pos.y);
    leftBoundaryValue = newY;
    if (Math.abs(newY) < SNAP_EPSILON) {
      if (snapStartTime === null) {
        snapStartTime = Date.now();
      }
    } else {
      snapStartTime = null;
    }
  } else if (draggingAxis) {
    const deltaY = pos.y - initialAxisMouseY;
    yScale = initialAxisYScale * Math.exp(deltaY * ZOOM_SENSITIVITY);
  }
  
  canvas.style.cursor = (!draggingLeftBoundary && !draggingAxis && pos.x < AXIS_DRAG_THRESHOLD) ? "ns-resize" : "default";
});

canvas.addEventListener('mouseup', function() {
  draggingLeftBoundary = false;
  draggingAxis = false;
  snapStartTime = null;
});
canvas.addEventListener('mouseleave', function() {
  draggingLeftBoundary = false;
  draggingAxis = false;
  snapStartTime = null;
});

// ------------------------------
// Other Controls & Buttons
// ------------------------------
document.getElementById('animIntervalInput').addEventListener('change', function() {
  animInterval = parseInt(this.value);
});

function updateWaveSpeedDisplay() {
  let tensionVal = parseFloat(document.getElementById('tension').value);
  let muVal = parseFloat(document.getElementById('massDensity').value);
  let cVal = Math.sqrt(tensionVal / muVal);
  document.getElementById('waveSpeedDisplay').textContent = cVal.toFixed(2) + " m/s";
}
document.getElementById('tensionInput').addEventListener('change', updateWaveSpeedDisplay);
document.getElementById('massDensityInput').addEventListener('change', updateWaveSpeedDisplay);
updateWaveSpeedDisplay();

// ------------------------------
// Simulate Checkbox Event Listeners
// ------------------------------
const simulateMainEl = document.getElementById("simulateMain");
if (simulateMainEl) {
  simulateMainEl.addEventListener("change", function() {
    if (this.checked) {
      resetMainSimulationState();
    }
  });
}

function attachSimulateCheckboxListener(row) {
  const checkbox = row.querySelector('.simulate-checkbox');
  const rowId = row.getAttribute('data-row-id');
  checkbox.addEventListener("change", function() {
    if (this.checked) {
      resetExtraSimulation(rowId);
    } else {
      if (extraSimulations[rowId]) {
        delete extraSimulations[rowId];
      }
    }
  });
}

// ------------------------------
// Add/Remove Functions in the Function Table
// ------------------------------
const tableBody = document.querySelector('#functionTable tbody');

// Create the initial row with an Apply button.
const initialRow = document.createElement('tr');
initialRow.setAttribute('data-row-id', functionCounter++);
initialRow.innerHTML = `
  <td>
    <input type="text" class="function-input" value="0">
    <button class="applyFunctionBtn">Apply</button>
  </td>
  <td><input type="checkbox" class="simulate-checkbox"></td>
  <td><input type="color" class="function-color" value="${getRandomColor()}"></td>
  <td>
    <select class="line-pattern">
      <option value="solid" selected>Solid</option>
      <option value="dashed">Dashed</option>
      <option value="dotted">Dotted</option>
    </select>
  </td>
  <td><button class="removeFunction">Remove</button></td>
`;
tableBody.appendChild(initialRow);
attachSimulateCheckboxListener(initialRow);
// Store initial applied function.
initialRow.dataset.appliedFunction = initialRow.querySelector('.function-input').value;

function getRandomColor() {
  var letters = '0123456789ABCDEF';
  var color = '#';
  for (var i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

document.getElementById('addFunctionBtn').addEventListener('click', () => {
  const tableBody = document.querySelector('#functionTable tbody');
  const newRow = document.createElement('tr');
  newRow.setAttribute('data-row-id', functionCounter++);
  newRow.innerHTML = `
    <td>
      <input type="text" class="function-input" value="0">
      <button class="applyFunctionBtn">Apply</button>
    </td>
    <td><input type="checkbox" class="simulate-checkbox"></td>
    <td><input type="color" class="function-color" value="${getRandomColor()}"></td>
    <td>
      <select class="line-pattern">
        <option value="solid" selected>Solid</option>
        <option value="dashed">Dashed</option>
        <option value="dotted">Dotted</option>
      </select>
    </td>
    <td><button class="removeFunction">Remove</button></td>
  `;
  tableBody.appendChild(newRow);
  attachSimulateCheckboxListener(newRow);
  
  var MQ = MathQuill.getInterface(2);
  let input = newRow.querySelector('.function-input');
  let span = document.createElement('span');
  span.className = 'mathquill-field';
  input.parentNode.insertBefore(span, input);
  input.style.display = 'none';
  let mqField = MQ.MathField(span, {
    spaceBehavesLikeTab: true,
    autoCommands: 'pi theta sqrt sum',
    autoOperatorNames: 'sin cos',
    handlers: {
      edit: function() {
        input.value = latexToMathJS(mqField.latex());
      }
    }
  });
  mqField.latex(input.value);
  
  // Initially store the function (applied value is the starting value)
  newRow.dataset.appliedFunction = input.value;
});

// ------------------------------
// Apply Button Listener: Store applied function for each row
// ------------------------------
document.querySelector('#functionTable tbody').addEventListener('click', (e) => {
  if (e.target && e.target.classList.contains('applyFunctionBtn')) {
    const row = e.target.closest('tr');
    const input = row.querySelector('.function-input');
    resetSimulation();
    // Save the current value as the applied function.
    row.dataset.appliedFunction = input.value;
  }
  
  // Remove function listener.
  if (e.target && e.target.classList.contains('removeFunction')) {
    const tableBody = document.querySelector('#functionTable tbody');
    if (tableBody.rows.length > 1) {
      const row = e.target.closest('tr');
      const rowId = row.getAttribute('data-row-id');
      row.remove();
      if (extraSimulations[rowId]) {
        delete extraSimulations[rowId];
      }
    }
  }
});

// ------------------------------
// Reset Simulation Button (resets main and extra simulations)
// ------------------------------
function resetSimulation() {
  L = parseFloat(document.getElementById('stringLength').value);
  tension = parseFloat(document.getElementById('tension').value);
  mu = parseFloat(document.getElementById('massDensity').value);
  gamma = parseFloat(document.getElementById('damping').value);
  N = parseInt(document.getElementById('resolution').value);
  
  c = Math.sqrt(tension / mu);
  dx = L / (N - 1);
  dt = r * dx / c;
  
  resetMainSimulationState();
  updateWaveSpeedDisplay();
  
  document.querySelectorAll('#functionTable tbody tr').forEach(row => {
    const simulateCheckbox = row.querySelector('.simulate-checkbox');
    const rowId = row.getAttribute('data-row-id');
    if (simulateCheckbox.checked) {
      resetExtraSimulation(rowId);
    } else {
      if (extraSimulations[rowId]) delete extraSimulations[rowId];
    }
  });
}
document.getElementById('resetBtn').addEventListener('click', resetSimulation);

// ------------------------------
// Zoom Reset Button
// ------------------------------
document.getElementById('zoomResetBtn').addEventListener('click', function() {
  yScale = parseFloat(defaults.yScale);
});
  
// ------------------------------
// Pause/Resume Button: Toggle Pause State and Update Icon
// ------------------------------
document.getElementById('pauseBtn').addEventListener('click', function() {
  paused = !paused;
  if (paused) {
    this.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24">
      <polygon points="8,5 19,12 8,19" fill="#e0e0e0"/>
    </svg>`;
  } else {
    this.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24">
      <rect x="6" y="4" width="4" height="16" fill="#e0e0e0"/>
      <rect x="14" y="4" width="4" height="16" fill="#e0e0e0"/>
    </svg>`;
  }
});

// ------------------------------
// Tab Switching for Control Mode
// ------------------------------
document.querySelectorAll('.tab-button').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    
    document.querySelectorAll('.tab-content').forEach(content => content.style.display = 'none');
    const tab = button.getAttribute('data-tab');
    document.getElementById('tab-' + tab).style.display = 'block';
    
    if (tab === "function") {
      controlMode = "function";
    } else {
      controlMode = "manual";
    }
  });
});

// ------------------------------
// LaTeX to MathJS Conversion Helpers
// ------------------------------
function findMatchingBrace(str, start) {
  let count = 0;
  for (let i = start; i < str.length; i++) {
    if (str[i] === '{') {
      count++;
    } else if (str[i] === '}') {
      count--;
      if (count === 0) {
        return i;
      }
    }
  }
  return -1; // no matching brace found
}

function replaceFractions(expr) {
  let index = expr.indexOf("\\frac");
  if (index === -1) return expr;
  
  let numStart = expr.indexOf("{", index);
  if (numStart === -1) return expr;
  let numEnd = findMatchingBrace(expr, numStart);
  if (numEnd === -1) return expr;
  let numerator = expr.slice(numStart + 1, numEnd);
  
  let denStart = expr.indexOf("{", numEnd);
  if (denStart === -1) return expr;
  let denEnd = findMatchingBrace(expr, denStart);
  if (denEnd === -1) return expr;
  let denominator = expr.slice(denStart + 1, denEnd);
  
  numerator = replaceFractions(numerator);
  denominator = replaceFractions(denominator);
  
  let replacement = "(" + numerator + ")/(" + denominator + ")";
  let newExpr = expr.slice(0, index) + replacement + expr.slice(denEnd + 1);
  
  return replaceFractions(newExpr);
}

function latexToMathJS(latex) {
  let expr = latex.trim();
  expr = expr.replace(/\\left/g, '');
  expr = expr.replace(/\\right/g, '');
  expr = replaceFractions(expr);
  expr = expr.replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)');
  expr = expr.replace(/([a-zA-Z0-9\)\]]+)\s*\^\s*\{([^}]*)\}/g, '$1^($2)');
  expr = expr.replace(/([a-zA-Z0-9\)\]]+)\s*\^\s*\(([^()]*)\)/g, '$1^($2)');
  expr = expr.replace(/([a-zA-Z0-9\)\]]+)\s*\^\s*([a-zA-Z0-9]+)/g, '$1^($2)');
  expr = expr.replace(/\\(sin|cos|tan|log|ln|exp)/g, '$1');
  expr = expr.replace(/\b(sin|cos|tan|log|ln|exp)\s*([a-zA-Z0-9]+)/g, '$1($2)');
  expr = expr.replace(/\\cdot|\\times/g, '*');
  expr = expr.replace(/[\{\}]/g, '');
  expr = expr.replace(/(\\pi)/g, 'pi');
  return expr;
}

(function initializeMathQuillFields() {
  var MQ = MathQuill.getInterface(2);
  document.querySelectorAll('.function-input').forEach(function(input) {
    let span = document.createElement('span');
    span.className = 'mathquill-field';
    input.parentNode.insertBefore(span, input);
    input.style.display = 'none';
    
    let initialLatex = input.value;
    let mqField = MQ.MathField(span, {
      spaceBehavesLikeTab: true,
      autoCommands: 'pi theta sqrt sum',
      autoOperatorNames: 'sin cos',
      handlers: {
        edit: function() {
          input.value = latexToMathJS(mqField.latex());
        }
      }
    });
    mqField.latex(initialLatex);
  });
})();

/**
 * Hardware Detection Service
 * 
 * Detects available hardware acceleration capabilities:
 * - NVIDIA GPU (NVENC/NVDEC via nvidia-smi)
 * - VAAPI (Linux integrated GPU acceleration)
 * - QuickSync (Intel GPU acceleration)
 * 
 * Results are cached at startup and exposed via API.
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const os = require('os');

// Cache detection results
let hwCapabilities = null;
const DEFAULT_DRI_DEVICE = '/dev/dri/renderD128';

function getConfiguredDriDevice() {
    return process.env.HW_DEVICE || process.env.LIBVA_DEVICE || DEFAULT_DRI_DEVICE;
}

function getRenderDevices() {
    const configuredDevice = getConfiguredDriDevice();

    if (configuredDevice && fs.existsSync(configuredDevice)) {
        return [configuredDevice];
    }

    try {
        return fs.readdirSync('/dev/dri')
            .filter(device => device.startsWith('renderD'))
            .sort()
            .map(device => `/dev/dri/${device}`);
    } catch {
        return [];
    }
}

/**
 * NVIDIA GPU compute capability requirements for codec support
 * Source: https://developer.nvidia.com/video-encode-and-decode-gpu-support-matrix-new
 */
const NVDEC_MIN_COMPUTE = {
    h264: 3.0,   // Kepler+
    hevc: 5.0,   // Maxwell GM206+
    av1: 8.0,    // Ada Lovelace+
};

/**
 * Detect NVIDIA GPU and its capabilities
 */
async function detectNvidia() {
    try {
        // Query GPU info via nvidia-smi
        const result = execSync(
            'nvidia-smi --query-gpu=name,compute_cap --format=csv,noheader',
            { timeout: 5000, encoding: 'utf-8', windowsHide: true }
        );

        const lines = result.trim().split('\n');
        if (lines.length === 0 || !lines[0]) {
            return { available: false };
        }

        // Parse "NVIDIA GeForce RTX 3080, 8.6"
        const parts = lines[0].split(',');
        if (parts.length < 2) {
            return { available: false };
        }

        const gpuName = parts[0].trim();
        const computeCap = parseFloat(parts[1].trim());

        // Determine supported codecs based on compute capability
        const supportedCodecs = [];
        for (const [codec, minCap] of Object.entries(NVDEC_MIN_COMPUTE)) {
            if (computeCap >= minCap) {
                supportedCodecs.push(codec);
            }
        }

        console.log(`[HwDetect] NVIDIA GPU detected: ${gpuName} (compute ${computeCap})`);
        console.log(`[HwDetect] NVDEC supported codecs: ${supportedCodecs.join(', ')}`);

        return {
            available: true,
            name: gpuName,
            computeCap,
            supportedCodecs,
            encoder: 'h264_nvenc',
            decoder: 'h264_cuvid'
        };
    } catch (err) {
        // nvidia-smi not found or no GPU
        console.log('[HwDetect] No NVIDIA GPU detected');
        return { available: false };
    }
}

/**
 * Detect VAAPI support (Linux only)
 * Checks for /dev/dri/renderD* devices
 */
async function detectVAAPI() {
    if (os.platform() !== 'linux') {
        return { available: false, reason: 'VAAPI is Linux-only' };
    }

    const devices = getRenderDevices();
    if (devices.length === 0) {
        return { available: false, reason: 'No render devices found' };
    }

    // Use configured device first, then first available render node.
    const device = devices[0];
    console.log(`[HwDetect] VAAPI device found: ${device}`);

    return {
        available: true,
        device,
        driver: process.env.LIBVA_DRIVER_NAME || null,
        encoder: 'h264_vaapi',
        decoder: 'vaapi'
    };
}

/**
 * Detect Intel QuickSync support
 * Checks if FFmpeg can use QSV
 */
async function detectQuickSync() {
    try {
        // Check if Intel GPU exists
        let hasIntelGpu = false;

        if (os.platform() === 'win32') {
            // Windows: Check via WMIC
            const result = execSync(
                'wmic path win32_VideoController get name',
                { timeout: 5000, encoding: 'utf-8', windowsHide: true }
            );
            hasIntelGpu = result.toLowerCase().includes('intel');
        } else if (os.platform() === 'linux') {
            // Linux: Check lspci
            try {
                const result = execSync('lspci | grep -i "vga\\|display" | grep -i intel', {
                    timeout: 5000,
                    encoding: 'utf-8',
                    shell: true
                });
                hasIntelGpu = result.trim().length > 0;
            } catch {
                hasIntelGpu = false;
            }

            // Containers may not expose enough PCI metadata. If the user has
            // explicitly selected Intel's media driver and passed a render node,
            // treat QSV as available and let FFmpeg be the final authority.
            if (!hasIntelGpu && process.env.LIBVA_DRIVER_NAME === 'iHD' && getRenderDevices().length > 0) {
                hasIntelGpu = true;
            }
        }

        if (!hasIntelGpu) {
            return { available: false, reason: 'No Intel GPU found' };
        }

        const device = getRenderDevices()[0] || getConfiguredDriDevice();
        console.log(`[HwDetect] Intel GPU detected, QSV may be available on ${device}`);

        return {
            available: true,
            device,
            encoder: 'h264_qsv',
            decoder: 'h264_qsv'
        };
    } catch (err) {
        console.log('[HwDetect] QuickSync not available');
        return { available: false };
    }
}

/**
 * Detect AMD AMF support (Windows only)
 * Linux AMD uses VAAPI (detected separately)
 */
async function detectAMF() {
    if (os.platform() !== 'win32') {
        // On Linux, AMD GPUs use VAAPI which is detected separately
        return { available: false, reason: 'AMF is Windows-only (Linux uses VAAPI)' };
    }

    try {
        // Windows: Check via WMIC for AMD/Radeon
        const result = execSync(
            'wmic path win32_VideoController get name',
            { timeout: 5000, encoding: 'utf-8', windowsHide: true }
        );

        const lowerResult = result.toLowerCase();
        const hasAmdGpu = lowerResult.includes('amd') || lowerResult.includes('radeon');

        if (!hasAmdGpu) {
            return { available: false, reason: 'No AMD GPU found' };
        }

        // Extract GPU name for display
        const lines = result.trim().split('\n').filter(l => l.trim());
        let gpuName = 'AMD GPU';
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.toLowerCase().includes('amd') || trimmed.toLowerCase().includes('radeon')) {
                gpuName = trimmed;
                break;
            }
        }

        console.log(`[HwDetect] AMD GPU detected: ${gpuName}`);

        return {
            available: true,
            name: gpuName,
            encoder: 'h264_amf',
            decoder: 'h264'  // AMF has limited decode support, often uses software
        };
    } catch (err) {
        console.log('[HwDetect] AMF not available');
        return { available: false };
    }
}

/**
 * Detect all hardware capabilities
 * Results are cached for performance
 */
async function detect() {
    if (hwCapabilities !== null) {
        return hwCapabilities;
    }

    console.log('[HwDetect] Probing hardware acceleration capabilities...');

    const [nvidia, vaapi, qsv, amf] = await Promise.all([
        detectNvidia(),
        detectVAAPI(),
        detectQuickSync(),
        detectAMF()
    ]);

    // Determine recommended encoder (priority: NVENC > AMF > QSV > VAAPI > Software)
    let recommended = 'software';
    if (nvidia.available) {
        recommended = 'nvenc';
    } else if (amf.available) {
        recommended = 'amf';
    } else if (qsv.available) {
        recommended = 'qsv';
    } else if (vaapi.available) {
        recommended = 'vaapi';
    }

    hwCapabilities = {
        nvidia,
        amf,
        vaapi,
        qsv,
        recommended,
        platform: os.platform(),
        detectedAt: new Date().toISOString()
    };

    console.log(`[HwDetect] Recommended encoder: ${recommended}`);

    return hwCapabilities;
}

/**
 * Get cached capabilities (or detect if not cached)
 */
function getCapabilities() {
    return hwCapabilities;
}

/**
 * Force re-detection (clears cache)
 */
async function refresh() {
    hwCapabilities = null;
    return detect();
}

module.exports = {
    detect,
    getCapabilities,
    refresh,
    getConfiguredDriDevice,
    detectNvidia,
    detectAMF,
    detectVAAPI,
    detectQuickSync
};

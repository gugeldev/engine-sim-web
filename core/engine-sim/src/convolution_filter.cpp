#include "../include/convolution_filter.h"

#include <cmath>
#include <cstring>

namespace {
    constexpr float Pi = 3.14159265358979323846f;

    // In-place iterative radix-2 FFT. `inverse` computes the unnormalized
    // inverse transform.
    void fft(std::complex<float> *data, int n, bool inverse) {
        for (int i = 1, j = 0; i < n; ++i) {
            int bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) std::swap(data[i], data[j]);
        }

        for (int len = 2; len <= n; len <<= 1) {
            const float angle = 2 * Pi / len * (inverse ? 1.0f : -1.0f);
            const std::complex<float> wlen(std::cos(angle), std::sin(angle));
            for (int i = 0; i < n; i += len) {
                std::complex<float> w(1.0f, 0.0f);
                const int half = len / 2;
                for (int k = 0; k < half; ++k) {
                    const std::complex<float> u = data[i + k];
                    const std::complex<float> v = data[i + k + half] * w;
                    data[i + k] = u + v;
                    data[i + k + half] = u - v;
                    w *= wlen;
                }
            }
        }
    }
}

ConvolutionFilter::ConvolutionFilter() {
    m_sampleCount = 0;
    m_partitions = 0;
    m_ready = false;
    m_fdlHead = 0;
    m_blockPosition = 0;
}

ConvolutionFilter::~ConvolutionFilter() {
    /* void */
}

void ConvolutionFilter::initialize(int samples) {
    m_sampleCount = samples;
    m_impulseResponse.assign(samples, 0.0f);
    m_ready = false;
}

void ConvolutionFilter::destroy() {
    m_impulseResponse.clear();
    m_irSpectra.clear();
    m_inputSpectra.clear();
    m_ready = false;
}

void ConvolutionFilter::finalizeImpulseResponse() {
    m_partitions = (m_sampleCount + BlockSize - 1) / BlockSize;
    if (m_partitions <= 0) {
        m_ready = false;
        return;
    }

    m_irSpectra.assign((size_t)m_partitions * FftSize, { 0.0f, 0.0f });
    m_inputSpectra.assign((size_t)m_partitions * FftSize, { 0.0f, 0.0f });
    m_inputWindow.assign(FftSize, 0.0f);
    m_outputBlock.assign(BlockSize, 0.0f);
    m_scratch.assign(FftSize, { 0.0f, 0.0f });
    m_accumulator.assign(FftSize, { 0.0f, 0.0f });
    m_fdlHead = 0;
    m_blockPosition = 0;

    for (int p = 0; p < m_partitions; ++p) {
        std::complex<float> *spectrum = &m_irSpectra[(size_t)p * FftSize];
        for (int i = 0; i < BlockSize; ++i) {
            const int index = p * BlockSize + i;
            spectrum[i] = (index < m_sampleCount) ? m_impulseResponse[index] : 0.0f;
        }
        fft(spectrum, FftSize, false);
    }

    m_ready = true;
}

void ConvolutionFilter::processBlock() {
    // Spectrum of [previous block | current block]
    for (int i = 0; i < FftSize; ++i) m_scratch[i] = m_inputWindow[i];
    fft(m_scratch.data(), FftSize, false);

    m_fdlHead = (m_fdlHead + m_partitions - 1) % m_partitions;
    std::memcpy(
        &m_inputSpectra[(size_t)m_fdlHead * FftSize],
        m_scratch.data(),
        sizeof(std::complex<float>) * FftSize);

    std::fill(m_accumulator.begin(), m_accumulator.end(), std::complex<float>(0.0f, 0.0f));
    for (int p = 0; p < m_partitions; ++p) {
        const int slot = (m_fdlHead + p) % m_partitions;
        const std::complex<float> *x = &m_inputSpectra[(size_t)slot * FftSize];
        const std::complex<float> *h = &m_irSpectra[(size_t)p * FftSize];
        for (int k = 0; k < FftSize; ++k) {
            m_accumulator[k] += x[k] * h[k];
        }
    }

    fft(m_accumulator.data(), FftSize, true);
    const float scale = 1.0f / FftSize;
    for (int i = 0; i < BlockSize; ++i) {
        m_outputBlock[i] = m_accumulator[BlockSize + i].real() * scale;
    }

    // Slide window: current block becomes previous block
    std::memmove(m_inputWindow.data(), m_inputWindow.data() + BlockSize, sizeof(float) * BlockSize);
}

float ConvolutionFilter::f(float sample) {
    if (!m_ready) return 0.0f;

    m_inputWindow[BlockSize + m_blockPosition] = sample;
    const float out = m_outputBlock[m_blockPosition];

    if (++m_blockPosition >= BlockSize) {
        m_blockPosition = 0;
        processBlock();
    }

    return out;
}

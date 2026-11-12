#ifndef ATG_ENGINE_SIM_CONVOLUTION_FILTER_H
#define ATG_ENGINE_SIM_CONVOLUTION_FILTER_H

#include "filter.h"

#include <complex>
#include <vector>

// engine-sim-web: the original filter was a direct-form convolution (O(N) per
// sample, N up to 10000 taps), which is far too slow for a browser. This
// replacement keeps the same interface but uses a uniformly partitioned
// overlap-save FFT convolution. It introduces a fixed latency of BlockSize
// samples, which is inaudible at 44.1 kHz.
class ConvolutionFilter : public Filter {
    public:
        static constexpr int BlockSize = 128;
        static constexpr int FftSize = BlockSize * 2;

        ConvolutionFilter();
        virtual ~ConvolutionFilter();

        void initialize(int samples);
        void destroy();

        // Must be called after the impulse response has been written through
        // getImpulseResponse(); prepares the partition spectra.
        void finalizeImpulseResponse();

        virtual float f(float sample);

        float *getImpulseResponse() { return m_impulseResponse.data(); }
        int getSampleCount() const { return m_sampleCount; }

    private:
        void processBlock();

        int m_sampleCount;
        int m_partitions;
        bool m_ready;

        std::vector<float> m_impulseResponse;
        std::vector<std::complex<float>> m_irSpectra;   // partitions * FftSize
        std::vector<std::complex<float>> m_inputSpectra; // partitions * FftSize (ring)
        int m_fdlHead;

        std::vector<float> m_inputWindow;   // FftSize: [previous block | current block]
        std::vector<float> m_outputBlock;   // BlockSize
        std::vector<std::complex<float>> m_scratch;
        std::vector<std::complex<float>> m_accumulator;
        int m_blockPosition;
};

#endif /* ATG_ENGINE_SIM_CONVOLUTION_FILTER_H */

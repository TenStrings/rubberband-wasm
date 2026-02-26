/* Minimal C ABI bridge for offline file pitch shifting in WebAssembly. */

#include "rubberband/rubberband-c.h"

#include <cstdint>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

struct RBContext {
    RubberBandState state = nullptr;
    unsigned int channels = 0;
    unsigned int chunkFrames = 0;
    unsigned int maxOutputFrames = 0;
    std::vector<std::vector<float>> inBuffers;
    std::vector<std::vector<float>> outBuffers;
    std::vector<float *> inPtrs;
    std::vector<float *> outPtrs;
};

extern "C" {

EMSCRIPTEN_KEEPALIVE
RBContext *rb_create(int sampleRate, int channels)
{
    if (sampleRate <= 0 || channels <= 0) return nullptr;

    auto *ctx = new RBContext();
    ctx->channels = static_cast<unsigned int>(channels);

    RubberBandOptions options = RubberBandOptionProcessOffline |
                                RubberBandOptionEngineFiner |
                                RubberBandOptionPitchHighQuality |
                                RubberBandOptionChannelsTogether;
    ctx->state = rubberband_new(static_cast<unsigned int>(sampleRate),
                                static_cast<unsigned int>(channels),
                                options, 1.0, 1.0);
    if (!ctx->state) {
        delete ctx;
        return nullptr;
    }

    ctx->chunkFrames = 1024;
    ctx->maxOutputFrames = 8192;

    rubberband_set_max_process_size(ctx->state, ctx->chunkFrames);

    if (rubberband_get_process_size_limit(ctx->state) == 0) {
        rubberband_delete(ctx->state);
        delete ctx;
        return nullptr;
    }

    ctx->inBuffers.resize(ctx->channels);
    ctx->outBuffers.resize(ctx->channels);
    ctx->inPtrs.resize(ctx->channels);
    ctx->outPtrs.resize(ctx->channels);

    for (unsigned int c = 0; c < ctx->channels; ++c) {
        ctx->inBuffers[c].resize(ctx->chunkFrames, 0.0f);
        ctx->outBuffers[c].resize(ctx->maxOutputFrames, 0.0f);
        ctx->inPtrs[c] = ctx->inBuffers[c].data();
        ctx->outPtrs[c] = ctx->outBuffers[c].data();
    }

    return ctx;
}

EMSCRIPTEN_KEEPALIVE
void rb_destroy(RBContext *ctx)
{
    if (!ctx) return;
    if (ctx->state) rubberband_delete(ctx->state);
    delete ctx;
}

EMSCRIPTEN_KEEPALIVE
int rb_get_chunk_size(RBContext *ctx)
{
    if (!ctx) return 0;
    return static_cast<int>(ctx->chunkFrames);
}

EMSCRIPTEN_KEEPALIVE
int rb_get_max_output_size(RBContext *ctx)
{
    if (!ctx) return 0;
    return static_cast<int>(ctx->maxOutputFrames);
}

EMSCRIPTEN_KEEPALIVE
void rb_reset(RBContext *ctx)
{
    if (!ctx || !ctx->state) return;
    rubberband_reset(ctx->state);
}

EMSCRIPTEN_KEEPALIVE
void rb_set_pitch_scale(RBContext *ctx, float scale)
{
    if (!ctx || !ctx->state || scale <= 0.0f) return;
    rubberband_set_pitch_scale(ctx->state, static_cast<double>(scale));
}

EMSCRIPTEN_KEEPALIVE
void rb_set_expected_input_duration(RBContext *ctx, int samples)
{
    if (!ctx || !ctx->state || samples < 0) return;
    rubberband_set_expected_input_duration(ctx->state,
                                           static_cast<unsigned int>(samples));
}

EMSCRIPTEN_KEEPALIVE
int rb_get_start_delay(RBContext *ctx)
{
    if (!ctx || !ctx->state) return 0;
    return static_cast<int>(rubberband_get_start_delay(ctx->state));
}

EMSCRIPTEN_KEEPALIVE
float *rb_get_input_channel_ptr(RBContext *ctx, int channel)
{
    if (!ctx) return nullptr;
    if (channel < 0 || static_cast<unsigned int>(channel) >= ctx->channels) {
        return nullptr;
    }
    return ctx->inPtrs[static_cast<unsigned int>(channel)];
}

EMSCRIPTEN_KEEPALIVE
float *rb_get_output_channel_ptr(RBContext *ctx, int channel)
{
    if (!ctx) return nullptr;
    if (channel < 0 || static_cast<unsigned int>(channel) >= ctx->channels) {
        return nullptr;
    }
    return ctx->outPtrs[static_cast<unsigned int>(channel)];
}

EMSCRIPTEN_KEEPALIVE
void rb_study(RBContext *ctx, int inputFrames, int final)
{
    if (!ctx || !ctx->state) return;
    if (inputFrames < 0) return;
    if (static_cast<unsigned int>(inputFrames) > ctx->chunkFrames) return;

    rubberband_study(ctx->state,
                     const_cast<const float *const *>(ctx->inPtrs.data()),
                     static_cast<unsigned int>(inputFrames),
                     final != 0);
}

EMSCRIPTEN_KEEPALIVE
void rb_calculate_stretch(RBContext *ctx)
{
    if (!ctx || !ctx->state) return;
    rubberband_calculate_stretch(ctx->state);
}

EMSCRIPTEN_KEEPALIVE
int rb_process(RBContext *ctx, int inputFrames, int final)
{
    if (!ctx || !ctx->state) return 0;
    if (inputFrames < 0) return 0;
    if (static_cast<unsigned int>(inputFrames) > ctx->chunkFrames) return 0;

    rubberband_process(ctx->state,
                       const_cast<const float *const *>(ctx->inPtrs.data()),
                       static_cast<unsigned int>(inputFrames),
                       final != 0);

    int available = rubberband_available(ctx->state);
    if (available <= 0) return 0;
    if (available > static_cast<int>(ctx->maxOutputFrames)) {
        available = static_cast<int>(ctx->maxOutputFrames);
    }

    return static_cast<int>(rubberband_retrieve(ctx->state,
                                                ctx->outPtrs.data(),
                                                static_cast<unsigned int>(available)));
}

} // extern "C"

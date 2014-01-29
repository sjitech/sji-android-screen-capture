
#Note: if you edit this file on Windows OS, please be sure to use
#UNIX style new line code, i mean 0xA (LF). Do not save 0xD 0xA!

log() {
    echo $* >&2
}

log "------------------- start capture `date` ----------------------"

FEED_FPS="$1"; shift || { log "require arg1: frames_per_second of raw image"; exit 1; }
FFMPEG_FPS="$1"; shift || { log "require arg2: frames_per_second for ffmpeg input"; exit 1; }
FFMPEG_OUTPUT="$@"; shift || { log "require arg3-...: ffmpeg output"; exit 1; }

chmod 755 * >&2 || exit 1

./busybox stty -onlcr >&2 || exit 1

{ GET_RAW_IMG_EXEC_FILE="./get-raw-image-4.1.2"; log "test $GET_RAW_IMG_EXEC_FILE"; IMG_FORMAT=`$GET_RAW_IMG_EXEC_FILE`; } || \
{ GET_RAW_IMG_EXEC_FILE="./get-raw-image-4"    ; log "test $GET_RAW_IMG_EXEC_FILE"; IMG_FORMAT=`$GET_RAW_IMG_EXEC_FILE`; } || \
{ GET_RAW_IMG_EXEC_FILE="./get-raw-image-old"  ; log "test $GET_RAW_IMG_EXEC_FILE"; IMG_FORMAT=`$GET_RAW_IMG_EXEC_FILE`; } || \
{ log "Failed to test get-raw-image-... and get image format"; exit 1; }

log "use: $GET_RAW_IMG_EXEC_FILE"
log "use: $IMG_FORMAT"

{ FFMPEG_EXEC_FILE="./ffmpeg.armv7"; log "test $FFMPEG_EXEC_FILE"; $FFMPEG_EXEC_FILE -version > /dev/null; } || \
{ FFMPEG_EXEC_FILE="./ffmpeg.armv5"; log "test $FFMPEG_EXEC_FILE"; $FFMPEG_EXEC_FILE -version > /dev/null; } || \
{ log "Failed test ffmpeg.armv..."; exit 1; }

log "use: $FFMPEG_EXEC_FILE"

FFMPEG_INPUT="-f rawvideo $IMG_FORMAT -r $FFMPEG_FPS -i -"  #intput from stdin
FFMPEG_CMDLINE="$FFMPEG_EXEC_FILE $FFMPEG_INPUT $FFMPEG_OUTPUT"

log "$GET_RAW_IMG_EXEC_FILE $FEED_FPS | $FFMPEG_CMDLINE"
$GET_RAW_IMG_EXEC_FILE $FEED_FPS | $FFMPEG_CMDLINE


#Note: if you edit this file on Windows OS, please be sure to use
#UNIX style new line code, i mean 0xA (LF). Do not save 0xD 0xA!

log() {
    echo $* >&2
}

log "------------------- start capture_raw `date` ----------------------"

./busybox stty -onlcr >&2 || exit 1

{ GET_RAW_IMG_EXEC_FILE="./get-raw-image-4.1.2"; log "$GET_RAW_IMG_EXEC_FILE"; $GET_RAW_IMG_EXEC_FILE 0; } || \
{ GET_RAW_IMG_EXEC_FILE="./get-raw-image-4"    ; log "$GET_RAW_IMG_EXEC_FILE"; $GET_RAW_IMG_EXEC_FILE 0; } || \
{ GET_RAW_IMG_EXEC_FILE="./get-raw-image-old"  ; log "$GET_RAW_IMG_EXEC_FILE"; $GET_RAW_IMG_EXEC_FILE 0; } || \
{ log "Failed to get-raw-image-..."; exit 1; }

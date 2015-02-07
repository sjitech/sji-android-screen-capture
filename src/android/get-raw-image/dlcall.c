#include <stdio.h>
#include <errno.h>
#include <unistd.h>
#include <dlfcn.h>

typedef int (*MAIN_ENTRY)(int argc, char** argv);

int main(int argc, char** argv){
	void* dl;
	MAIN_ENTRY f;
    dl=dlopen(argv[1], RTLD_NOW);
    if (!dl) {
        fprintf(stderr, "%s: %s\n", argv[1], dlerror());
        return -1;
    }
    f = dlsym(dl, argv[2]);
    if (!f) {
        fprintf(stderr, "%s:%s: %s\n", argv[1], argv[2], dlerror());
        return -1;
    }
    argv[2] = argv[0];
    return f(argc-2, argv+2);
}

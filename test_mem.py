import subprocess,sys,time
def freepct():
    try:
        o=subprocess.check_output(["memory_pressure"]).decode()
        return int(o.split("System-wide memory free percentage:")[1].split("%")[0].strip())
    except Exception: return -1
m=sys.argv[1]; times=[]
t=time.time(); subprocess.run(["qwen-code","-p","hi"],capture_output=True,timeout=1800)
d=time.time()-t; times.append(d); print(f"  {m} turn01: {d:6.1f}s free={freepct()}%",flush=True)
for i in range(14):
    f=freepct()
    if 0 <= f < 22: print(f"  !! free {f}% — stopping at turn {i+2}",flush=True); break
    t=time.time()
    subprocess.run(["qwen-code","--continue","-p",f"turn {i+2}, reply with just: ok"],capture_output=True,timeout=1800)
    d=time.time()-t; times.append(d); print(f"  {m} turn{i+2:02d}: {d:6.1f}s free={freepct()}%",flush=True)
warm=times[1:]
if warm:
    print(f"  {m} SUMMARY: turn1={times[0]:.1f}s  warm median={sorted(warm)[len(warm)//2]:.1f}s  warm max={max(warm):.1f}s  n={len(times)}")

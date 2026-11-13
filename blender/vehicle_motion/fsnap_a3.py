import sys; sys.path.insert(0,__import__('os').path.expanduser('~/Desktop/Code/test/ar_rifle_demo/blender'))
from vehicle_motion import judge
ctx = bpy.app.driver_namespace['vehicle_motion']; L=ctx['last']
V=judge.world_parts(L['baked'], L['roots'])
for k in ('foot_l','foot_r','hand_l','hand_r'):
    tr=[v[k] for v in V]; vel=[(b-a)*30 for a,b in zip(tr,tr[1:])]; dv=[(b-a).length for a,b in zip(vel,vel[1:])]
    top=sorted(range(len(dv)), key=lambda i:-dv[i])[:4]; print(k, [(i+1, round(dv[i],2)) for i in top])

"""Deterministic Blender-authored equipment and tiled PBR atlases for visitors.

No new downloaded images: the surface finish is generated from mathematical
patterns. The source models and their rig animation remain Quaternius CC0.
"""
import math
import bpy
import numpy as np
from mathutils import Matrix


DETAILS = {
    'robot-scout': 'recessed chest telemetry and sensor lamps',
    'robot-worker': 'industrial chest panel, cooling bars and shoulder fasteners',
    'robot-courier': 'cargo backpack with rails, long signal antenna and chest dispatch display',
    'robot-sentinel': 'heavy shoulder shells, raised optical pod, reinforced chest and rear power cells',
    'alien-scout': 'tactile skin surface and wearable expedition chest beacon',
    'alien-resident': 'clear atmospheric helmet and pressure-control chest unit',
    'alien-envoy': 'ceremonial shoulder mantle, collar rings and ornamental brooch',
    'alien-navigator': 'three-fin head crest, survey pack and shoulder navigation lights',
}
PALETTES = {
    'robot-scout': ((.56, .30, .075), (.13, .20, .23)),
    'robot-worker': ((.12, .23, .19), (.65, .28, .065)),
    'robot-courier': ((.095, .26, .34), (.85, .47, .13)),
    'robot-sentinel': ((.16, .19, .25), (.57, .16, .085)),
    'alien-scout': ((.075, .30, .24), (.028, .075, .07)),
    'alien-resident': ((.13, .23, .34), (.045, .08, .13)),
    'alien-envoy': ((.35, .145, .24), (.11, .035, .08)),
    'alien-navigator': ((.34, .27, .095), (.12, .075, .032)),
}


def select(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.hide_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def finish_part(obj, rig, bone, material, name, bevel=0):
    obj.name = name
    select(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new('Machined edge radius', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 3
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
    obj.data.materials.append(material)
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.parent_type = 'BONE'
    obj.parent_bone = bone
    bpy.context.view_layer.update()
    obj.matrix_world = world
    return obj


def polish_geometry(meshes, robot):
    """Keep the stylized silhouette while providing smooth curved surfaces."""
    for obj in meshes:
        select(obj)
        if not robot:
            # Subdivide before skin deformation so weights interpolate with the
            # new vertices. Applying after an evaluated pose would bake a pose.
            modifier=obj.modifiers.new('Organic surface refinement','SUBSURF')
            modifier.levels=1;modifier.render_levels=1
            bpy.ops.object.modifier_move_to_index(modifier=modifier.name,index=0)
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(45 if robot else 65))


def equipment(rig, slug):
    """Attach purposeful equipment in rig rest space; bake weights later."""
    rig.animation_data.action = None
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    mats = {}
    for name, color in [('Equipment', (.075, .095, .12, 1)),
                        ('Trim', (.46, .33, .13, 1)),
                        ('Signal', (.12, .70, .80, 1))]:
        mat = bpy.data.materials.new(name)
        mat.diffuse_color = color
        mats[name] = mat
    parts = []

    def box(name, pos, size, bone='Torso', mat='Equipment', bevel=.035):
        bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
        obj = bpy.context.object
        obj.scale = size
        parts.append(finish_part(obj, rig, bone, mats[mat], name, bevel))

    def orb(name, pos, scale, bone='Head', mat='Trim'):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=1, location=pos)
        obj = bpy.context.object
        obj.scale = scale
        parts.append(finish_part(obj, rig, bone, mats[mat], name))

    def tube(name, pos, radius, depth, bone='Torso', mat='Trim', rotation=None):
        bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=radius, depth=depth, location=pos)
        obj = bpy.context.object
        if rotation:
            obj.rotation_euler = rotation
        parts.append(finish_part(obj, rig, bone, mats[mat], name, radius * .12))

    if slug in {'robot-scout', 'robot-courier'}:
        box('Recessed telemetry housing', (0, -.65, 2.28), (.70, .13, .40), bone='Body')
        for i in range(3):
            box('Telemetry indicator', (-.22 + i*.22, -.731, 2.29), (.115, .025, .08), bone='Body', mat='Signal', bevel=.009)
        if slug == 'robot-courier':
            box('Cargo case', (0, .94, 2.05), (1.36, .66, 1.13), bone='Body', bevel=.10)
            box('Cargo lid', (0, .95, 2.66), (1.46, .73, .15), bone='Body', mat='Trim')
            for x in (-.5, .5):
                box('Cargo retention rail', (x, 1.31, 2.08), (.08, .08, 1.00), bone='Body', mat='Trim', bevel=.02)
            tube('Signal aerial', (.72, .10, 4.66), .035, .73, bone='Head')
            orb('Aerial lamp', (.72, .10, 5.02), (.085, .085, .085), mat='Signal')
    elif slug in {'robot-worker', 'robot-sentinel'}:
        box('Chest electronics', (.04, -.57, 3.88), (1.02, .17, .63), bone='Chest', bevel=.06)
        for x in (-.27, 0, .27):
            box('Cooling grille', (x, -.67, 3.92), (.10, .04, .34), bone='Chest', mat='Trim', bevel=.01)
        for side in (-1, 1):
            orb('Shoulder fastener', (side * .8, -.16, 4.8), (.17, .07, .17), bone='UpperArm.L' if side>0 else 'UpperArm.R', mat='Trim')
        if slug == 'robot-sentinel':
            for side in (-1, 1):
                bone = 'UpperArm.L' if side > 0 else 'UpperArm.R'
                box('Sentinel shoulder shell', (side*1.06, .12, 4.91), (.90, .88, .44), bone=bone, bevel=.14)
                box('Shoulder identification stripe', (side*1.06, -.34, 4.92), (.63, .05, .12), bone=bone, mat='Trim', bevel=.02)
                tube('Power cell', (side*.49, .93, 3.64), .22, 1.13, bone='Chest')
            box('Optical crown', (.07, -.27, 5.37), (.95, .85, .43), bone='Head', bevel=.10)
            box('Crown lens', (.07, -.71, 5.39), (.52, .06, .15), bone='Head', mat='Signal')
    else:
        box('Chest instrument', (.0, -.36, 1.32), (.26, .10, .25), mat='Equipment', bevel=.04)
        orb('Instrument status light', (0, -.421, 1.34), (.05, .022, .05), bone='Torso', mat='Signal')
        if slug == 'alien-resident':
            for x in (-.19, .19):
                tube('Pressure regulator', (x, -.32, 1.15), .058, .28, mat='Trim')
        elif slug == 'alien-envoy':
            for side in (-1, 1):
                orb('Ceremonial shoulder mantle', (side*.43, .025, 1.66), (.35, .30, .13), bone='Shoulder.L' if side>0 else 'Shoulder.R', mat='Equipment')
                orb('Mantle clasp', (side*.43, -.266, 1.66), (.062, .03, .052), bone='Shoulder.L' if side>0 else 'Shoulder.R', mat='Trim')
            for z, radius in [(1.65,.31),(1.70,.29)]:
                bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=.032, major_segments=28, minor_segments=8, location=(0,.05,z))
                parts.append(finish_part(bpy.context.object, rig, 'Neck', mats['Trim'], 'Ceremonial neck ring'))
            orb('Envoy brooch', (0,-.411,1.43), (.08,.024,.13), bone='Torso', mat='Trim')
        elif slug == 'alien-navigator':
            # Three tapered fins are actual geometry and follow the head bone.
            for y, height in [(-.15,.42),(.08,.53),(.31,.37)]:
                bpy.ops.mesh.primitive_cone_add(vertices=5, radius1=.16, radius2=.012, depth=height, location=(0,y,2.91+height/2))
                obj=bpy.context.object;obj.scale=(.45,1,1)
                parts.append(finish_part(obj,rig,'Head',mats['Trim'],'Navigator cranial fin',.014))
            box('Survey pack', (0,.46,1.32), (.54,.36,.65), bevel=.08)
            for side in (-1,1):
                orb('Shoulder locator', (side*.44,.04,1.72), (.13,.16,.10), bone='Shoulder.L' if side>0 else 'Shoulder.R',mat='Equipment')
                orb('Locator light', (side*.44,-.12,1.72), (.07,.025,.042), bone='Shoulder.L' if side>0 else 'Shoulder.R',mat='Signal')
    return parts


def image(name, pixels, size, noncolor=False):
    result = bpy.data.images.new(name, width=size, height=size, alpha=True)
    result.colorspace_settings.name = 'Non-Color' if noncolor else 'sRGB'
    result.pixels.foreach_set(np.asarray(pixels, dtype=np.float32).reshape(-1))
    result.pack()
    return result


def surfaces(meshes, slug):
    """Real UV islands with padding, shared 1024 base/512 normal + ORM atlases."""
    materials = sorted({mat for obj in meshes for mat in obj.data.materials if mat}, key=lambda mat: mat.name)
    columns = math.ceil(math.sqrt(len(materials)))
    indices = {mat.name: index for index, mat in enumerate(materials)}
    robot = slug.startswith('robot')
    primary, accent = PALETTES[slug]
    specifications = []
    for mat in materials:
        name = mat.name
        color = tuple(mat.diffuse_color[:3])
        if name == 'Main': color = primary
        elif name in {'Accent', 'Stripe'}: color = accent
        elif name == 'Trim': color = (.58, .36, .12) if not robot else accent
        elif name in {'Grey','LightGrey','White'}: color = (.42,.47,.48) if robot else (.64,.69,.65)
        skin = not robot and name in {'Main','Stripe'}
        smooth = name in {'Glass','Eye','Eyes','Signal'}
        metal = .5 if robot or name in {'Equipment','Trim'} else 0
        if name in {'Black','Eye','Eyes','Glass','Signal'}: metal=.05
        rough = .64 if skin else .4 if metal else .63
        if smooth: rough=.15 if name=='Glass' else .22
        specifications.append((color,rough,metal,skin,smooth))

    atlases=[]
    for kind, size in [('BaseColor',1024),('ORM',512),('Normal',512)]:
        pixels=np.ones((size,size,4),np.float32)
        tile=size//columns
        for index,(color,rough,metal,skin,smooth) in enumerate(specifications):
            x=(index%columns)*tile;y=(index//columns)*tile
            yy,xx=np.mgrid[0:tile,0:tile].astype(np.float32)/tile
            grain=(np.sin(xx*217+np.sin(yy*93)*2)*np.sin(yy*181+xx*41))
            pores=np.sin(xx*124+np.sin(yy*103))*np.sin(yy*147+xx*28)
            if skin:
                variation=.025*pores+.018*np.sin(xx*17+yy*11)
                relief=.055*pores
            elif smooth:
                variation=.004*grain;relief=.004*grain
            else:
                # Brushed paint, restrained scratches and fine inset panel lines.
                seam=(np.abs(np.sin(xx*math.pi*4))<.012)|(np.abs(np.sin(yy*math.pi*4))<.012)
                variation=.019*grain-.025*seam
                relief=.025*grain-.035*seam
            patch=np.ones((tile,tile,4),np.float32)
            if kind=='BaseColor':
                linear=np.maximum(np.array(color)[None,None,:]*(1+variation[:,:,None]),0)
                patch[:,:,:3]=np.where(linear<.0031308,linear*12.92,1.055*linear**(1/2.4)-.055)
            elif kind=='ORM':
                patch[:,:,0]=1
                patch[:,:,1]=np.clip(rough+variation*.65,0,1)
                patch[:,:,2]=metal
            else:
                dy,dx=np.gradient(relief)
                norm=np.sqrt(dx*dx+dy*dy+1)
                patch[:,:,0]=(-dx/norm+1)/2
                patch[:,:,1]=(-dy/norm+1)/2
                patch[:,:,2]=(1/norm+1)/2
            pixels[y:y+tile,x:x+tile]=patch
        atlases.append(image(f'{slug}_{kind}',pixels,size,kind!='BaseColor'))

    for mat in materials:
        mat.use_nodes=True
        nodes=mat.node_tree.nodes;nodes.clear();links=mat.node_tree.links
        output=nodes.new('ShaderNodeOutputMaterial')
        bsdf=nodes.new('ShaderNodeBsdfPrincipled');links.new(bsdf.outputs['BSDF'],output.inputs['Surface'])
        color=nodes.new('ShaderNodeTexImage');color.image=atlases[0]
        links.new(color.outputs['Color'],bsdf.inputs['Base Color'])
        orm=nodes.new('ShaderNodeTexImage');orm.image=atlases[1]
        separate=nodes.new('ShaderNodeSeparateColor');links.new(orm.outputs['Color'],separate.inputs['Color'])
        links.new(separate.outputs['Green'],bsdf.inputs['Roughness'])
        links.new(separate.outputs['Blue'],bsdf.inputs['Metallic'])
        normal=nodes.new('ShaderNodeTexImage');normal.image=atlases[2]
        normal_map=nodes.new('ShaderNodeNormalMap');links.new(normal.outputs['Color'],normal_map.inputs['Color'])
        links.new(normal_map.outputs['Normal'],bsdf.inputs['Normal'])
        if mat.name=='Glass':
            bsdf.inputs['Alpha'].default_value=.12
            mat.surface_render_method='BLENDED';mat.use_backface_culling=True
        if mat.name in {'Signal','Eye'}:
            bsdf.inputs['Emission Color'].default_value=(.07,.55,.72,1)
            bsdf.inputs['Emission Strength'].default_value=.65

    for obj in meshes:
        select(obj)
        # One shared layer name is essential: Blender join otherwise preserves
        # separate source/equipment layers and exports blank equipment UVs.
        for layer in list(obj.data.uv_layers): obj.data.uv_layers.remove(layer)
        obj.data.uv_layers.new(name='SurfaceUV')
        # Source flat-color UVs are often degenerate. Regenerate all of them.
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.reveal();bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(65),island_margin=.025)
        bpy.ops.object.mode_set(mode='OBJECT')
        uv=obj.data.uv_layers.active.data
        for polygon in obj.data.polygons:
            mat=obj.data.materials[polygon.material_index]
            index=indices[mat.name]
            tx=index%columns;ty=index//columns
            for loop in polygon.loop_indices:
                u,v=uv[loop].uv
                # Eight percent tile gutter prevents bilinear/mipmap bleed.
                uv[loop].uv=((tx+.04+u*.92)/columns,(ty+.04+v*.92)/columns)
    return {'baseColor':[1024,1024],'normal':[512,512],'metallicRoughness':[512,512],
            'materialCount':len(materials),'embeddedImages':3}
